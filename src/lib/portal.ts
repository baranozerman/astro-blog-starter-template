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
	parent_id: number | null;
	created_by: number | null;
}

export interface FolderAccess {
	folder: Folder;
	/** Breadcrumb from the top-level folder down to (and including) this one. */
	path: { id: number; name: string }[];
	rootId: number;
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
	moved: "Taşındı.",
	renamed: "Yeniden adlandırıldı.",
	folder_created: "Klasör oluşturuldu.",
	notempty: "Bu klasör boş değil. İçindekileri önce taşıyın veya silin.",
	badmove: "Bir klasör kendi içine taşınamaz.",
	noselection: "Lütfen en az bir öğe seçin.",
};

export function parseId(value: string | undefined | null) {
	const n = Number(value);
	return Number.isInteger(n) && n > 0 ? n : null;
}

/** Top-level folders the user can open, with file counts over their whole subtree. */
export async function listAccessibleFolders(db: D1Database, user: SessionUser) {
	type Row = Folder & {
		can_read: number;
		can_upload: number;
		file_count: number;
		folder_count: number;
		last_upload: number | null;
	};
	const stats = `
		WITH RECURSIVE tree(root_id, id) AS (
			SELECT id, id FROM folders WHERE parent_id IS NULL
			UNION ALL
			SELECT tree.root_id, f.id FROM folders f JOIN tree ON f.parent_id = tree.id
		),
		stats AS (
			SELECT tree.root_id,
			       COUNT(DISTINCT files.id) AS file_count,
			       COUNT(DISTINCT tree.id) - 1 AS folder_count,
			       MAX(files.created_at) AS last_upload
			FROM tree LEFT JOIN files ON files.folder_id = tree.id
			GROUP BY tree.root_id
		)`;
	const query =
		user.role === "admin"
			? db.prepare(
					`${stats}
					 SELECT f.*, 1 AS can_read, 1 AS can_upload, s.file_count, s.folder_count, s.last_upload
					 FROM folders f JOIN stats s ON s.root_id = f.id
					 ORDER BY f.name COLLATE NOCASE`,
				)
			: db
					.prepare(
						`${stats}
						 SELECT f.*, p.can_read, p.can_upload, s.file_count, s.folder_count, s.last_upload
						 FROM folders f JOIN stats s ON s.root_id = f.id
						 JOIN permissions p ON p.folder_id = f.id
						 WHERE p.user_id = ? AND (p.can_read = 1 OR p.can_upload = 1)
						 ORDER BY f.name COLLATE NOCASE`,
					)
					.bind(user.id);
	return (await query.all<Row>()).results;
}

/** The folder plus its ancestors, top-level first. */
export async function folderPath(db: D1Database, folderId: number) {
	const { results } = await db
		.prepare(
			`WITH RECURSIVE anc(id, parent_id, depth) AS (
				SELECT id, parent_id, 0 FROM folders WHERE id = ?
				UNION ALL
				SELECT f.id, f.parent_id, anc.depth + 1 FROM folders f JOIN anc ON f.id = anc.parent_id
				WHERE anc.depth < 50
			)
			SELECT f.* FROM anc JOIN folders f ON f.id = anc.id ORDER BY anc.depth DESC`,
		)
		.bind(folderId)
		.all<Folder>();
	return results;
}

/** Access to a folder is decided by the permissions on its top-level folder. */
export async function getFolderAccess(
	db: D1Database,
	user: SessionUser,
	folderId: number,
): Promise<FolderAccess | null> {
	const chain = await folderPath(db, folderId);
	if (chain.length === 0) return null;
	const folder = chain[chain.length - 1];
	const rootId = chain[0].id;
	const path = chain.map((f) => ({ id: f.id, name: f.name }));
	if (user.role === "admin") return { folder, path, rootId, canRead: true, canUpload: true };

	const perm = await db
		.prepare("SELECT can_read, can_upload FROM permissions WHERE user_id = ? AND folder_id = ?")
		.bind(user.id, rootId)
		.first<{ can_read: number; can_upload: number }>();
	if (!perm || (!perm.can_read && !perm.can_upload)) return null;
	return { folder, path, rootId, canRead: perm.can_read === 1, canUpload: perm.can_upload === 1 };
}

/** Ids of a folder and everything below it. */
export async function subtreeIds(db: D1Database, folderId: number) {
	const { results } = await db
		.prepare(
			`WITH RECURSIVE tree(id) AS (
				SELECT ? UNION ALL SELECT f.id FROM folders f JOIN tree ON f.parent_id = tree.id
			) SELECT id FROM tree`,
		)
		.bind(folderId)
		.all<{ id: number }>();
	return results.map((r) => r.id);
}

/** Every folder under the given top-level folders, labelled with its full path (for "move to"). */
export async function folderTree(db: D1Database, rootIds: number[] | "all") {
	const where = rootIds === "all" ? "parent_id IS NULL" : `id IN (${rootIds.map(() => "?").join(",") || "NULL"})`;
	const { results } = await db
		.prepare(
			`WITH RECURSIVE t(id, path, depth) AS (
				SELECT id, name, 0 FROM folders WHERE ${where}
				UNION ALL
				SELECT f.id, t.path || ' / ' || f.name, t.depth + 1 FROM folders f JOIN t ON f.parent_id = t.id
				WHERE t.depth < 50
			)
			SELECT id, path, depth FROM t ORDER BY path COLLATE NOCASE`,
		)
		.bind(...(rootIds === "all" ? [] : rootIds))
		.all<{ id: number; path: string; depth: number }>();
	return results;
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
