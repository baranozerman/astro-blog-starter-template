import type { APIRoute } from "astro";
import {
	INLINE_TYPES,
	audit,
	contentDisposition,
	getFolderAccess,
	parseId,
	type FileRow,
} from "../../../lib/portal";

export const prerender = false;

const notFound = () => new Response("Dosya bulunamadı.", { status: 404 });

export const GET: APIRoute = async ({ params, locals, url }) => {
	const { DB, FILES } = locals.runtime.env;
	const user = locals.user!;
	const fileId = parseId(params.id);
	if (!fileId) return notFound();

	const file = await DB.prepare("SELECT * FROM files WHERE id = ?").bind(fileId).first<FileRow>();
	if (!file) return notFound();
	const access = await getFolderAccess(DB, user, file.folder_id);
	// Upload-only users may still download what they uploaded themselves.
	if (!access || !(access.canRead || file.uploaded_by === user.id)) return notFound();

	const object = await FILES.get(file.r2_key);
	if (!object) return notFound();

	const inline = url.searchParams.has("inline") && INLINE_TYPES.has(file.content_type);
	locals.runtime.ctx.waitUntil(
		audit(DB, user.id, "download", `${access.folder.name} / ${file.name}`).run(),
	);

	const headers = new Headers({
		"Content-Type": inline ? file.content_type : "application/octet-stream",
		"Content-Length": String(object.size),
		"Content-Disposition": contentDisposition(inline ? "inline" : "attachment", file.name),
		"X-Content-Type-Options": "nosniff",
	});
	// Chrome refuses to open PDFs in a sandboxed document, so only sandbox the other types.
	if (file.content_type !== "application/pdf") {
		headers.set("Content-Security-Policy", "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox");
	}
	return new Response(object.body, { headers });
};
