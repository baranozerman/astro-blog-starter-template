import type { SessionUser } from "./auth";

// Workers accept request bodies up to 100 MB on Free/Pro plans; leave room for multipart overhead.
export const MAX_UPLOAD_BYTES = 95 * 1024 * 1024;

// Types safe to show in the browser. Everything else is always served as a download.
export const INLINE_TYPES = new Set([
	"application/pdf",
	"image/png",
	"image/jpeg",
	"image/gif",
	"image/webp",
	"text/plain",
]);

export interface Folder {
	id: number;
	name: string;
	description: string;
}

export interface FolderAccess {
	folder: Folder;
	canRead: boolean;
	canUpload: boolean;
}

export interface FileRow {
	id: number;
	folder_id: number;
	r2_key: string;
	name: string;
	size: number;
	content_type: string;
	uploaded_by: number | null;
	created_at: number;
}

/** Flash messages shown after redirects, keyed by the `ok` / `err` query parameter. */
export const MESSAGES: Record<string, string> = {
	uploaded: "Dosya(lar) yüklendi.",
	deleted: "Silindi.",
	saved: "Değişiklikler kaydedildi.",
	created: "Oluşturuldu.",
	password: "Şifre güncellendi.",
	nofile: "Lütfen en az bir dosya seçin.",
	toolarge: `Dosya çok büyük (en fazla ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)} MB).`,
	forbidden: "Bu işlem için yetkiniz yok.",
	self: "Kendi yönetici yetkinizi kaldıramaz, hesabınızı silemez veya pasifleştiremezsiniz.",
	exists: "Bu e-posta adresiyle kayıtlı bir kullanıcı zaten var.",
	invalid: "Lütfen formdaki alanları kontrol edin.",
	storage: "Dosya sunucusuna şu anda ulaşılamıyor. Lütfen biraz sonra tekrar deneyin.",
};

export function parseId(value: string | undefined | null) {
	const n = Number(value);
	return Number.isInteger(n) && n > 0 ? n : null;
}

export async function listAccessibleFolders(db: D1Database, user: SessionUser) {
	type Row = Folder & { can_read: number; can_upload: number; file_count: number; last_upload: number | null };
	const fileCount = `(SELECT COUNT(*) FROM files WHERE folder_id = f.id) AS file_count,
		(SELECT MAX(created_at) FROM files WHERE folder_id = f.id) AS last_upload`;
	const query =
		user.role === "admin"
			? db.prepare(
					`SELECT f.id, f.name, f.description, 1 AS can_read, 1 AS can_upload, ${fileCount}
					 FROM folders f ORDER BY f.name COLLATE NOCASE`,
				)
			: db
					.prepare(
						`SELECT f.id, f.name, f.description, p.can_read, p.can_upload, ${fileCount}
						 FROM folders f JOIN permissions p ON p.folder_id = f.id
						 WHERE p.user_id = ? AND (p.can_read = 1 OR p.can_upload = 1)
						 ORDER BY f.name COLLATE NOCASE`,
					)
					.bind(user.id);
	return (await query.all<Row>()).results;
}

export async function getFolderAccess(
	db: D1Database,
	user: SessionUser,
	folderId: number,
): Promise<FolderAccess | null> {
	const folder = await db
		.prepare("SELECT id, name, description FROM folders WHERE id = ?")
		.bind(folderId)
		.first<Folder>();
	if (!folder) return null;
	if (user.role === "admin") return { folder, canRead: true, canUpload: true };

	const perm = await db
		.prepare("SELECT can_read, can_upload FROM permissions WHERE user_id = ? AND folder_id = ?")
		.bind(user.id, folderId)
		.first<{ can_read: number; can_upload: number }>();
	if (!perm || (!perm.can_read && !perm.can_upload)) return null;
	return { folder, canRead: perm.can_read === 1, canUpload: perm.can_upload === 1 };
}

export function audit(db: D1Database, userId: number | null, action: string, detail = "") {
	return db
		.prepare("INSERT INTO audit_log (user_id, action, detail) VALUES (?, ?, ?)")
		.bind(userId, action, detail);
}

export function cleanFileName(name: string) {
	const base = name.split(/[\\/]/).pop() ?? "";
	// eslint-disable-next-line no-control-regex
	const cleaned = base.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 200);
	return cleaned || "dosya";
}

export function contentDisposition(type: "inline" | "attachment", name: string) {
	const ascii = name.replace(/[^\x20-\x7e]|["\\]/g, "_");
	return `${type}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

export function formatBytes(bytes: number) {
	if (bytes < 1024) return `${bytes} B`;
	const units = ["KB", "MB", "GB"];
	let value = bytes / 1024;
	let unit = 0;
	while (value >= 1024 && unit < units.length - 1) {
		value /= 1024;
		unit++;
	}
	return `${value.toLocaleString("tr-TR", { maximumFractionDigits: 1 })} ${units[unit]}`;
}

/** Short label for the file-type badge plus a color group. */
export function fileKind(name: string) {
	const ext = (name.match(/\.([a-z0-9]{1,5})$/i)?.[1] ?? "").toLowerCase();
	const groups: Record<string, string[]> = {
		pdf: ["pdf"],
		img: ["png", "jpg", "jpeg", "gif", "webp", "heic", "svg", "tif", "tiff"],
		cad: ["dwg", "dxf", "step", "stp", "igs", "iges", "sldprt", "sldasm", "slddrw", "ipt", "iam", "x_t"],
		sheet: ["xls", "xlsx", "xlsm", "csv", "ods"],
		doc: ["doc", "docx", "odt", "rtf", "txt", "ppt", "pptx"],
		zip: ["zip", "rar", "7z", "gz", "tar"],
	};
	const group = Object.keys(groups).find((g) => groups[g].includes(ext)) ?? "other";
	return { label: ext ? ext.slice(0, 4).toUpperCase() : "DOSYA", group };
}

/** "3 gün önce" style relative time for recent dates, absolute date otherwise. */
export function formatRelative(seconds: number) {
	const diff = Math.floor(Date.now() / 1000) - seconds;
	if (diff < 60) return "az önce";
	if (diff < 3600) return `${Math.floor(diff / 60)} dk önce`;
	if (diff < 86400) return `${Math.floor(diff / 3600)} saat önce`;
	if (diff < 7 * 86400) return `${Math.floor(diff / 86400)} gün önce`;
	return new Date(seconds * 1000).toLocaleDateString("tr-TR", { timeZone: "Europe/Istanbul", dateStyle: "medium" });
}

export function formatDate(seconds: number) {
	return new Date(seconds * 1000).toLocaleString("tr-TR", {
		timeZone: "Europe/Istanbul",
		dateStyle: "medium",
		timeStyle: "short",
	});
}

/** Only allow redirects back into the portal. */
export function safeNext(next: string | null) {
	return next && next.startsWith("/portal") && !next.startsWith("//") ? next : "/portal";
}
