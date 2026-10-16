-- Prodinox Customer Portal: initial schema

CREATE TABLE users (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	email TEXT NOT NULL UNIQUE COLLATE NOCASE,
	name TEXT NOT NULL,
	company TEXT NOT NULL DEFAULT '',
	password_hash TEXT NOT NULL,
	role TEXT NOT NULL DEFAULT 'customer' CHECK (role IN ('admin', 'customer')),
	active INTEGER NOT NULL DEFAULT 1,
	failed_logins INTEGER NOT NULL DEFAULT 0,
	locked_until INTEGER,
	created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE sessions (
	id TEXT PRIMARY KEY, -- SHA-256 of the cookie token
	user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	expires_at INTEGER NOT NULL,
	created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX idx_sessions_user ON sessions(user_id);
CREATE INDEX idx_sessions_expires ON sessions(expires_at);

CREATE TABLE folders (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	name TEXT NOT NULL,
	description TEXT NOT NULL DEFAULT '',
	created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE permissions (
	user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	folder_id INTEGER NOT NULL REFERENCES folders(id) ON DELETE CASCADE,
	can_read INTEGER NOT NULL DEFAULT 0,
	can_upload INTEGER NOT NULL DEFAULT 0,
	PRIMARY KEY (user_id, folder_id)
);
CREATE INDEX idx_permissions_folder ON permissions(folder_id);

CREATE TABLE files (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	folder_id INTEGER NOT NULL REFERENCES folders(id) ON DELETE CASCADE,
	r2_key TEXT NOT NULL UNIQUE,
	name TEXT NOT NULL,
	size INTEGER NOT NULL,
	content_type TEXT NOT NULL,
	uploaded_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
	created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX idx_files_folder ON files(folder_id, created_at);

CREATE TABLE audit_log (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
	action TEXT NOT NULL,
	detail TEXT NOT NULL DEFAULT '',
	created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX idx_audit_created ON audit_log(created_at);
