import type { APIRoute } from "astro";
import {
	CHUNK_BYTES,
	MAX_FILE_BYTES,
	audit,
	cleanFileName,
	formatBytes,
	getFolderAccess,
	parseId,
} from "../../../../lib/portal";
import { newStoredKey } from "../../../../lib/storage";

export const prerender = false;

/**
 * Uploads larger than one request allows (Cloudflare caps a request body at
 * 100 MB) are sent in parts straight into an R2 multipart upload:
 *
 *   POST ?op=start     {name, size, type}       → {id, chunkSize, parts}
 *   PUT  ?op=part&id=&n=  <bytes of part n>     → {etag}
 *   POST ?op=complete  {id, parts:[{partNumber, etag}]}
 *   POST ?op=abort     {id}
 *
 * Every call re-checks the session user's upload right on the folder, and an
 * upload can only be continued by the user who started it, in the same folder.
 */

type UploadRow = {
	id: string;
	user_id: number;
	folder_id: number;
	r2_key: string;
	upload_id: string;
	name: string;
	size: number;
	content_type: string;
};

// Unfinished uploads older than this are aborted (R2 also expires them after 7 days).
const STALE_SECONDS = 2 * 24 * 60 * 60;

const json = (body: unknown, status = 200) =>
	new Response(JSON.stringify(body), {
		status,
		headers: { "Content-Type": "application/json; charset=utf-8" },
	});

const partCount = (size: number) => Math.max(1, Math.ceil(size / CHUNK_BYTES));
const partLength = (size: number, n: number) => (n < partCount(size) ? CHUNK_BYTES : size - (partCount(size) - 1) * CHUNK_BYTES);

async function handle({ params, locals, request, url }: Parameters<APIRoute>[0]) {
	const env = locals.runtime.env;
	const { DB, FILES } = env;
	const user = locals.user!;
	const { t } = locals;

	// These calls are made by the portal's own script; refuse anything sent from another site.
	if (request.headers.get("Origin") !== url.origin) return json({ error: t("err.forbidden_origin") }, 403);
	// Files on the NAS are written in one request; that path keeps using the upload form.
	if (env.WEBDAV_URL) return json({ error: t("flash.toolarge", { mb: 95 }) }, 409);

	const folderId = parseId(params.id);
	const access = folderId ? await getFolderAccess(DB, user, folderId) : null;
	if (!access || !access.canUpload) return json({ error: t("flash.forbidden") }, 403);
	const folder = access.folder;

	const find = (id: unknown) =>
		DB.prepare("SELECT * FROM uploads WHERE id = ? AND user_id = ? AND folder_id = ?")
			.bind(String(id), user.id, folder.id)
			.first<UploadRow>();

	const op = url.searchParams.get("op");

	if (op === "start" && request.method === "POST") {
		const body = (await request.json().catch(() => null)) as { name?: unknown; size?: unknown; type?: unknown } | null;
		const size = Number(body?.size);
		if (!body || !Number.isSafeInteger(size) || size <= 0) return json({ error: t("flash.nofile") }, 400);
		if (size > MAX_FILE_BYTES) {
			const max = formatBytes(MAX_FILE_BYTES, locals.lang);
			return json({ error: t("fm.js.file_too_big", { name: String(body.name ?? ""), size: formatBytes(size, locals.lang), max }) }, 413);
		}
		const name = cleanFileName(String(body.name ?? ""));
		const type = String(body.type ?? "").slice(0, 200);
		const contentType = /^[\w.+-]+\/[\w.+-]+$/.test(type) ? type : "application/octet-stream";

		// Tidy up uploads nobody finished.
		const stale = await DB.prepare("SELECT * FROM uploads WHERE created_at < unixepoch() - ?")
			.bind(STALE_SECONDS)
			.all<UploadRow>();
		for (const row of stale.results) {
			await FILES.resumeMultipartUpload(row.r2_key, row.upload_id).abort().catch(() => {});
			await DB.prepare("DELETE FROM uploads WHERE id = ?").bind(row.id).run();
		}

		const key = newStoredKey("r2", folder.id, name);
		const upload = await FILES.createMultipartUpload(key, { httpMetadata: { contentType } });
		const id = crypto.randomUUID();
		await DB.prepare(
			`INSERT INTO uploads (id, user_id, folder_id, r2_key, upload_id, name, size, content_type)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		)
			.bind(id, user.id, folder.id, key, upload.uploadId, name, size, contentType)
			.run();
		return json({ id, chunkSize: CHUNK_BYTES, parts: partCount(size) });
	}

	if (op === "part" && request.method === "PUT") {
		const row = await find(url.searchParams.get("id"));
		if (!row) return json({ error: t("err.upload_gone") }, 404);
		const n = Number(url.searchParams.get("n"));
		if (!Number.isInteger(n) || n < 1 || n > partCount(row.size)) return json({ error: "part" }, 400);
		// R2 needs every part but the last to be the same size; check before streaming it in.
		const expected = partLength(row.size, n);
		if (Number(request.headers.get("Content-Length")) !== expected || !request.body) {
			return json({ error: "length" }, 400);
		}
		const part = await FILES.resumeMultipartUpload(row.r2_key, row.upload_id).uploadPart(n, request.body);
		return json({ etag: part.etag });
	}

	if (op === "complete" && request.method === "POST") {
		const body = (await request.json().catch(() => null)) as {
			id?: unknown;
			parts?: { partNumber?: unknown; etag?: unknown }[];
		} | null;
		const row = await find(body?.id);
		if (!row) return json({ error: t("err.upload_gone") }, 404);
		const total = partCount(row.size);
		const parts = (Array.isArray(body?.parts) ? body.parts : [])
			.map((p) => ({ partNumber: Number(p.partNumber), etag: String(p.etag ?? "") }))
			.sort((a, b) => a.partNumber - b.partNumber);
		if (parts.length !== total || parts.some((p, i) => p.partNumber !== i + 1 || !p.etag)) {
			return json({ error: "parts" }, 400);
		}

		// Claim the row first so a repeated call cannot add the file twice.
		const claimed = await DB.prepare("DELETE FROM uploads WHERE id = ? RETURNING id").bind(row.id).first();
		if (!claimed) return json({ error: t("err.upload_gone") }, 404);

		const object = await FILES.resumeMultipartUpload(row.r2_key, row.upload_id).complete(parts);
		if (object.size !== row.size) {
			await FILES.delete(row.r2_key);
			return json({ error: "size" }, 400);
		}
		const pathLabel = access.path.map((p) => p.name).join(" / ");
		await DB.batch([
			DB.prepare(
				`INSERT INTO files (folder_id, r2_key, name, size, content_type, uploaded_by)
				 VALUES (?, ?, ?, ?, ?, ?)`,
			).bind(folder.id, row.r2_key, row.name, row.size, row.content_type, user.id),
			audit(DB, user.id, "upload", `${pathLabel} / ${row.name}`),
		]);
		return json({ ok: true });
	}

	if (op === "abort" && request.method === "POST") {
		const body = (await request.json().catch(() => null)) as { id?: unknown } | null;
		const row = await find(body?.id);
		if (row) {
			await DB.prepare("DELETE FROM uploads WHERE id = ?").bind(row.id).run();
			await FILES.resumeMultipartUpload(row.r2_key, row.upload_id).abort().catch(() => {});
		}
		return json({ ok: true });
	}

	return json({ error: "op" }, 400);
}

export const POST: APIRoute = (context) => handle(context);
export const PUT: APIRoute = (context) => handle(context);
