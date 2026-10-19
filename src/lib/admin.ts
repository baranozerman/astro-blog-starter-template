/** Data helpers for the admin panel: customers, top-level folders and the access matrix. */
import { audit } from "./portal";

/** Access a customer has to a top-level folder (and, by inheritance, everything in it). */
export type Level = "none" | "read" | "upload" | "both";
export const LEVELS: Level[] = ["none", "read", "upload", "both"];

export function toLevel(canRead: number | boolean, canUpload: number | boolean): Level {
	if (canRead && canUpload) return "both";
	if (canRead) return "read";
	if (canUpload) return "upload";
	return "none";
}

export function parseLevel(value: unknown): Level | null {
	return LEVELS.includes(value as Level) ? (value as Level) : null;
}

export interface UserRow {
	id: number;
	email: string;
	name: string;
	company: string;
	role: "admin" | "customer";
	active: number;
	locked_until: number | null;
	created_at: number;
	last_login: number | null;
	folder_count: number;
}

export async function listUsers(db: D1Database) {
	const { results } = await db
		.prepare(
			`SELECT u.id, u.email, u.name, u.company, u.role, u.active, u.locked_until, u.created_at,
			        (SELECT MAX(created_at) FROM audit_log a WHERE a.user_id = u.id AND a.action = 'login') AS last_login,
			        (SELECT COUNT(*) FROM permissions p JOIN folders f ON f.id = p.folder_id
			         WHERE p.user_id = u.id AND f.parent_id IS NULL AND (p.can_read = 1 OR p.can_upload = 1)) AS folder_count
			 FROM users u
			 ORDER BY u.role DESC, u.company COLLATE NOCASE, u.name COLLATE NOCASE`,
		)
		.all<UserRow>();
	return results;
}

export interface RootRow {
	id: number;
	name: string;
	description: string;
	file_count: number;
	sub_count: number;
	user_count: number;
	bytes: number;
}

/** Top-level folders with totals over their whole subtree. */
export async function listRoots(db: D1Database) {
	const { results } = await db
		.prepare(
			`WITH RECURSIVE tree(root_id, id) AS (
				SELECT id, id FROM folders WHERE parent_id IS NULL
				UNION ALL
				SELECT tree.root_id, f.id FROM folders f JOIN tree ON f.parent_id = tree.id
			)
			SELECT f.id, f.name, f.description,
			       (SELECT COUNT(*) FROM files WHERE folder_id IN (SELECT id FROM tree WHERE root_id = f.id)) AS file_count,
			       (SELECT COALESCE(SUM(size), 0) FROM files WHERE folder_id IN (SELECT id FROM tree WHERE root_id = f.id)) AS bytes,
			       (SELECT COUNT(*) FROM tree WHERE root_id = f.id) - 1 AS sub_count,
			       (SELECT COUNT(*) FROM permissions p JOIN users u ON u.id = p.user_id
			        WHERE p.folder_id = f.id AND u.role = 'customer' AND (p.can_read = 1 OR p.can_upload = 1)) AS user_count
			FROM folders f WHERE f.parent_id IS NULL
			ORDER BY f.name COLLATE NOCASE`,
		)
		.all<RootRow>();
	return results;
}

/** Map of "userId:folderId" → level for every stored permission on top-level folders. */
export async function permissionMap(db: D1Database) {
	const { results } = await db
		.prepare(
			`SELECT p.user_id, p.folder_id, p.can_read, p.can_upload
			 FROM permissions p JOIN folders f ON f.id = p.folder_id
			 WHERE f.parent_id IS NULL`,
		)
		.all<{ user_id: number; folder_id: number; can_read: number; can_upload: number }>();
	const map = new Map<string, Level>();
	for (const r of results) map.set(`${r.user_id}:${r.folder_id}`, toLevel(r.can_read, r.can_upload));
	return map;
}

export interface AccessChange {
	userId: number;
	folderId: number;
	level: Level;
}

/**
 * Reads access fields named `access:<userId>:<folderId>` from a form.
 * Only customers and top-level folders are accepted.
 */
export async function readAccessForm(db: D1Database, form: FormData): Promise<AccessChange[]> {
	const changes: AccessChange[] = [];
	for (const [key, value] of form.entries()) {
		const m = /^access:(\d+):(\d+)$/.exec(key);
		const level = parseLevel(value);
		if (m && level) changes.push({ userId: Number(m[1]), folderId: Number(m[2]), level });
	}
	if (changes.length === 0) return [];
	const [customers, roots] = await db.batch<{ id: number }>([
		db.prepare("SELECT id FROM users WHERE role = 'customer'"),
		db.prepare("SELECT id FROM folders WHERE parent_id IS NULL"),
	]);
	const customerIds = new Set(customers.results.map((r) => r.id));
	const rootIds = new Set(roots.results.map((r) => r.id));
	return changes.filter((c) => customerIds.has(c.userId) && rootIds.has(c.folderId));
}

/** Applies access changes and records each one in the activity log. */
export async function saveAccess(db: D1Database, adminId: number, changes: AccessChange[]) {
	if (changes.length === 0) return;
	const names = await db.batch<{ id: number; label: string }>([
		db.prepare("SELECT id, email AS label FROM users"),
		db.prepare("SELECT id, name AS label FROM folders WHERE parent_id IS NULL"),
	]);
	const userLabel = new Map(names[0].results.map((r) => [r.id, r.label]));
	const folderLabel = new Map(names[1].results.map((r) => [r.id, r.label]));

	const statements = changes.flatMap((c) => [
		c.level === "none"
			? db.prepare("DELETE FROM permissions WHERE user_id = ? AND folder_id = ?").bind(c.userId, c.folderId)
			: db
					.prepare(
						`INSERT INTO permissions (user_id, folder_id, can_read, can_upload) VALUES (?, ?, ?, ?)
						 ON CONFLICT (user_id, folder_id) DO UPDATE SET can_read = excluded.can_read, can_upload = excluded.can_upload`,
					)
					.bind(
						c.userId,
						c.folderId,
						c.level === "read" || c.level === "both" ? 1 : 0,
						c.level === "upload" || c.level === "both" ? 1 : 0,
					),
		audit(db, adminId, "permissions", `${userLabel.get(c.userId)} · ${folderLabel.get(c.folderId)} → ${c.level}`),
	]);
	// Keep each batch comfortably small.
	for (let i = 0; i < statements.length; i += 50) {
		await db.batch(statements.slice(i, i + 50));
	}
}

/** Readable random password without look-alike characters. */
export function randomPassword(length = 14) {
	const alphabet = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
	const bytes = crypto.getRandomValues(new Uint8Array(length));
	return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}
