import type { APIRoute } from "astro";
import {
	INLINE_TYPES,
	audit,
	contentDisposition,
	getFolderAccess,
	parseId,
	type FileRow,
} from "../../../lib/portal";
import { StorageError, resolveKey } from "../../../lib/storage";

export const prerender = false;

export const GET: APIRoute = async ({ params, locals, url }) => {
	const notFound = () =>
		new Response(locals.t("err.file_not_found"), {
			status: 404,
			headers: { "Content-Type": "text/plain; charset=utf-8" },
		});
	const env = locals.runtime.env;
	const { DB } = env;
	const user = locals.user!;
	const fileId = parseId(params.id);
	if (!fileId) return notFound();

	const file = await DB.prepare("SELECT * FROM files WHERE id = ?").bind(fileId).first<FileRow>();
	if (!file) return notFound();
	const access = await getFolderAccess(DB, user, file.folder_id);
	// Upload-only users may still download what they uploaded themselves.
	if (!access || !(access.canRead || file.uploaded_by === user.id)) return notFound();

	let object;
	try {
		const { storage, key } = resolveKey(env, file.r2_key);
		object = await storage.get(key);
	} catch (e) {
		if (!(e instanceof StorageError)) throw e;
		console.error(e.message);
		return new Response(locals.t("flash.storage"), {
			status: 503,
			headers: { "Content-Type": "text/plain; charset=utf-8" },
		});
	}
	if (!object) return notFound();

	const inline = url.searchParams.has("inline") && INLINE_TYPES.has(file.content_type);
	locals.runtime.ctx.waitUntil(
		audit(DB, user.id, "download", `${access.folder.name} / ${file.name}`).run(),
	);

	const headers = new Headers({
		"Content-Type": inline ? file.content_type : "application/octet-stream",
		"Content-Length": String(file.size),
		"Content-Disposition": contentDisposition(inline ? "inline" : "attachment", file.name),
		"X-Content-Type-Options": "nosniff",
	});
	// Chrome refuses to open PDFs in a sandboxed document, so only sandbox the other types.
	if (file.content_type !== "application/pdf") {
		headers.set("Content-Security-Policy", "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox");
	}
	return new Response(object, { headers });
};
