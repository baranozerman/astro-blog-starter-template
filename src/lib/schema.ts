/**
 * Schema upgrades applied automatically at runtime, so a deploy never needs a
 * manual SQL step. Each upgrade is idempotent. The base schema still comes
 * from migrations/0001_init.sql.
 */

let ready: Promise<void> | null = null;

async function hasColumn(db: D1Database, table: string, column: string) {
	const row = await db
		.prepare("SELECT 1 AS ok FROM pragma_table_info(?) WHERE name = ?")
		.bind(table, column)
		.first();
	return row !== null;
}

async function upgrade(db: D1Database) {
	// Failed sign-ins per client (hashed IP), for throttling password guessing
	// spread across many accounts.
	await db.batch([
		db.prepare("CREATE TABLE IF NOT EXISTS login_failures (client TEXT NOT NULL, at INTEGER NOT NULL)"),
		db.prepare("CREATE INDEX IF NOT EXISTS idx_login_failures ON login_failures(client, at)"),
	]);

	// Two-factor authentication (TOTP). totp_secret holds a pending secret
	// while totp_enabled = 0 and the user is still scanning the QR code.
	if (!(await hasColumn(db, "users", "totp_enabled"))) {
		try {
			await db.batch([
				db.prepare("ALTER TABLE users ADD COLUMN totp_secret TEXT"),
				db.prepare("ALTER TABLE users ADD COLUMN totp_enabled INTEGER NOT NULL DEFAULT 0"),
				db.prepare("ALTER TABLE users ADD COLUMN totp_last_step INTEGER"),
			]);
		} catch (e) {
			if (!String(e).includes("duplicate column")) throw e;
		}
	}
	await db.batch([
		db.prepare(
			`CREATE TABLE IF NOT EXISTS recovery_codes (
				user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
				code_hash TEXT NOT NULL,
				used_at INTEGER
			)`,
		),
		db.prepare("CREATE INDEX IF NOT EXISTS idx_recovery_user ON recovery_codes(user_id)"),
		// Password checked, waiting for the second factor. id is the SHA-256 of the cookie token.
		db.prepare(
			`CREATE TABLE IF NOT EXISTS mfa_challenges (
				id TEXT PRIMARY KEY,
				user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
				expires_at INTEGER NOT NULL,
				attempts INTEGER NOT NULL DEFAULT 0
			)`,
		),
	]);

	// Nested folders: a folder may live inside another one. Permissions are
	// granted on top-level folders and inherited by everything below them.
	if (!(await hasColumn(db, "folders", "parent_id"))) {
		try {
			await db.batch([
				db.prepare("ALTER TABLE folders ADD COLUMN parent_id INTEGER REFERENCES folders(id) ON DELETE CASCADE"),
				db.prepare("ALTER TABLE folders ADD COLUMN created_by INTEGER REFERENCES users(id) ON DELETE SET NULL"),
				db.prepare("CREATE INDEX IF NOT EXISTS idx_folders_parent ON folders(parent_id)"),
			]);
		} catch (e) {
			// Another worker instance applied it at the same moment.
			if (!String(e).includes("duplicate column")) throw e;
		}
	}
}

/** Runs pending upgrades once per worker instance. */
export function ensureSchema(db: D1Database) {
	ready ??= upgrade(db).catch((e) => {
		ready = null; // retry on the next request
		throw e;
	});
	return ready;
}
