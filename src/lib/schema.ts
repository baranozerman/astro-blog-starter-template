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
