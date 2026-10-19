import type { AstroCookies } from "astro";
import type { Translate } from "./i18n";
import { newRecoveryCodes, normalizeRecoveryCode, verifyTotp } from "./totp";

export const SESSION_COOKIE = "prodinox_session";
export const MFA_COOKIE = "prodinox_mfa";
const MFA_TTL = 5 * 60;
const MAX_MFA_ATTEMPTS = 5;
const SESSION_TTL = 60 * 60 * 24 * 7; // 7 days
// Workers caps PBKDF2 at 100k iterations.
const PBKDF2_ITERATIONS = 100_000;
const MAX_FAILED_LOGINS = 5;
const LOCK_SECONDS = 15 * 60;
// Per client: at most this many failed sign-ins (any account) per window.
const MAX_CLIENT_FAILURES = 20;
const CLIENT_WINDOW_SECONDS = 15 * 60;
export const MIN_PASSWORD_LENGTH = 10;

export type Role = "admin" | "customer";

export interface SessionUser {
	id: number;
	email: string;
	name: string;
	company: string;
	role: Role;
}

const encoder = new TextEncoder();

export const now = () => Math.floor(Date.now() / 1000);

function toBase64(bytes: Uint8Array) {
	let s = "";
	for (const b of bytes) s += String.fromCharCode(b);
	return btoa(s);
}

function fromBase64(s: string) {
	return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
}

async function sha256Hex(value: string) {
	const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
	return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function pbkdf2(password: string, salt: Uint8Array<ArrayBuffer>, iterations: number) {
	const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, [
		"deriveBits",
	]);
	const bits = await crypto.subtle.deriveBits(
		{ name: "PBKDF2", hash: "SHA-256", salt, iterations },
		key,
		256,
	);
	return new Uint8Array(bits);
}

export async function hashPassword(password: string) {
	const salt = crypto.getRandomValues(new Uint8Array(16));
	const hash = await pbkdf2(password, salt, PBKDF2_ITERATIONS);
	return `pbkdf2$${PBKDF2_ITERATIONS}$${toBase64(salt)}$${toBase64(hash)}`;
}

export async function verifyPassword(password: string, stored: string) {
	const [scheme, iterations, salt, hash] = stored.split("$");
	if (scheme !== "pbkdf2" || !salt || !hash) return false;
	const expected = fromBase64(hash);
	const actual = await pbkdf2(password, fromBase64(salt), Number(iterations));
	if (actual.length !== expected.length) return false;
	let diff = 0;
	for (let i = 0; i < actual.length; i++) diff |= actual[i] ^ expected[i];
	return diff === 0;
}

/** Returns a translated error when the password is too weak, otherwise "". */
export function passwordProblem(password: string, t: Translate): string {
	return password.length < MIN_PASSWORD_LENGTH ? t("err.password_short", { n: MIN_PASSWORD_LENGTH }) : "";
}

export type LoginResult = { userId: number } | { error: "invalid" | "locked" | "throttled" };

/** Identifies the client by a hash of its IP, so raw addresses are never stored. */
async function clientKey(request: Request) {
	return sha256Hex(`login:${request.headers.get("CF-Connecting-IP") ?? "local"}`);
}

/** True when this client has too many recent failed sign-ins (password or 2FA code). */
export async function clientThrottled(db: D1Database, request: Request) {
	const recent = await db
		.prepare("SELECT COUNT(*) AS n FROM login_failures WHERE client = ? AND at > ?")
		.bind(await clientKey(request), now() - CLIENT_WINDOW_SECONDS)
		.first<number>("n");
	return (recent ?? 0) >= MAX_CLIENT_FAILURES;
}

export async function recordClientFailure(db: D1Database, request: Request) {
	await db.batch([
		db.prepare("DELETE FROM login_failures WHERE at < ?").bind(now() - CLIENT_WINDOW_SECONDS),
		db.prepare("INSERT INTO login_failures (client, at) VALUES (?, ?)").bind(await clientKey(request), now()),
	]);
}

export async function attemptLogin(
	db: D1Database,
	request: Request,
	email: string,
	password: string,
): Promise<LoginResult> {
	if (await clientThrottled(db, request)) return { error: "throttled" };
	const result = await checkCredentials(db, email, password);
	if ("error" in result) await recordClientFailure(db, request);
	return result;
}

async function checkCredentials(db: D1Database, email: string, password: string): Promise<LoginResult> {
	const row = await db
		.prepare(
			"SELECT id, password_hash, active, failed_logins, locked_until FROM users WHERE email = ?",
		)
		.bind(email)
		.first<{
			id: number;
			password_hash: string;
			active: number;
			failed_logins: number;
			locked_until: number | null;
		}>();

	if (!row) {
		// Spend the same time as a real check so unknown emails aren't distinguishable.
		await hashPassword(password);
		return { error: "invalid" };
	}
	if (row.locked_until && row.locked_until > now()) return { error: "locked" };

	const ok = await verifyPassword(password, row.password_hash);
	if (!ok) {
		const failed = row.failed_logins + 1;
		const lock = failed >= MAX_FAILED_LOGINS;
		await db
			.prepare("UPDATE users SET failed_logins = ?, locked_until = ? WHERE id = ?")
			.bind(lock ? 0 : failed, lock ? now() + LOCK_SECONDS : null, row.id)
			.run();
		return { error: lock ? "locked" : "invalid" };
	}
	if (!row.active) return { error: "invalid" };

	await db
		.prepare("UPDATE users SET failed_logins = 0, locked_until = NULL WHERE id = ?")
		.bind(row.id)
		.run();
	return { userId: row.id };
}

function randomToken() {
	const bytes = crypto.getRandomValues(new Uint8Array(32));
	return toBase64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function createSession(db: D1Database, cookies: AstroCookies, url: URL, userId: number) {
	const token = randomToken();
	const expires = now() + SESSION_TTL;
	await db.batch([
		db.prepare("DELETE FROM sessions WHERE expires_at < ?").bind(now()),
		db
			.prepare("INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)")
			.bind(await sha256Hex(token), userId, expires),
	]);
	cookies.set(SESSION_COOKIE, token, {
		httpOnly: true,
		secure: url.protocol === "https:",
		sameSite: "lax",
		path: "/",
		expires: new Date(expires * 1000),
	});
}

export async function getSessionUser(db: D1Database, token: string): Promise<SessionUser | null> {
	return db
		.prepare(
			`SELECT u.id, u.email, u.name, u.company, u.role
			 FROM sessions s JOIN users u ON u.id = s.user_id
			 WHERE s.id = ? AND s.expires_at > ? AND u.active = 1`,
		)
		.bind(await sha256Hex(token), now())
		.first<SessionUser>();
}

export async function destroySession(db: D1Database, cookies: AstroCookies) {
	const token = cookies.get(SESSION_COOKIE)?.value;
	if (token) {
		await db.prepare("DELETE FROM sessions WHERE id = ?").bind(await sha256Hex(token)).run();
	}
	cookies.delete(SESSION_COOKIE, { path: "/" });
}

/** Logs the user out everywhere except (optionally) the session holding `keepToken`. */
export async function destroyUserSessions(db: D1Database, userId: number, keepToken?: string) {
	if (keepToken) {
		await db
			.prepare("DELETE FROM sessions WHERE user_id = ? AND id != ?")
			.bind(userId, await sha256Hex(keepToken))
			.run();
	} else {
		await db.prepare("DELETE FROM sessions WHERE user_id = ?").bind(userId).run();
	}
}

// ---- Two-factor authentication ----

export async function hasTotp(db: D1Database, userId: number) {
	return (await db.prepare("SELECT totp_enabled FROM users WHERE id = ?").bind(userId).first<number>("totp_enabled")) === 1;
}

/** After a correct password: remember the user for a few minutes while they enter their code. */
export async function startMfaChallenge(db: D1Database, cookies: AstroCookies, url: URL, userId: number) {
	const token = randomToken();
	await db.batch([
		db.prepare("DELETE FROM mfa_challenges WHERE expires_at < ? OR user_id = ?").bind(now(), userId),
		db.prepare("INSERT INTO mfa_challenges (id, user_id, expires_at) VALUES (?, ?, ?)").bind(
			await sha256Hex(token),
			userId,
			now() + MFA_TTL,
		),
	]);
	cookies.set(MFA_COOKIE, token, {
		httpOnly: true,
		secure: url.protocol === "https:",
		sameSite: "lax",
		path: "/portal",
		maxAge: MFA_TTL,
	});
}

export interface MfaChallenge {
	id: string;
	user_id: number;
	attempts: number;
	email: string;
}

export async function getMfaChallenge(db: D1Database, cookies: AstroCookies) {
	const token = cookies.get(MFA_COOKIE)?.value;
	if (!token) return null;
	return db
		.prepare(
			`SELECT c.id, c.user_id, c.attempts, u.email FROM mfa_challenges c JOIN users u ON u.id = c.user_id
			 WHERE c.id = ? AND c.expires_at > ? AND u.active = 1 AND u.totp_enabled = 1`,
		)
		.bind(await sha256Hex(token), now())
		.first<MfaChallenge>();
}

/** Counts a wrong code; returns false once the challenge is used up (and removes it). */
export async function failMfaChallenge(db: D1Database, cookies: AstroCookies, challenge: MfaChallenge) {
	if (challenge.attempts + 1 >= MAX_MFA_ATTEMPTS) {
		await endMfaChallenge(db, cookies, challenge);
		return false;
	}
	await db.prepare("UPDATE mfa_challenges SET attempts = attempts + 1 WHERE id = ?").bind(challenge.id).run();
	return true;
}

export async function endMfaChallenge(db: D1Database, cookies: AstroCookies, challenge: MfaChallenge) {
	await db.prepare("DELETE FROM mfa_challenges WHERE id = ?").bind(challenge.id).run();
	cookies.delete(MFA_COOKIE, { path: "/portal" });
}

/**
 * Checks an authenticator code, or failing that a recovery code (used up on success).
 * Pass a pending secret to confirm setup before 2FA is switched on.
 */
export async function checkSecondFactor(
	db: D1Database,
	userId: number,
	code: string,
	opts: { allowRecovery?: boolean; pendingSecret?: boolean } = {},
): Promise<"totp" | "recovery" | null> {
	const row = await db
		.prepare("SELECT totp_secret, totp_enabled, totp_last_step FROM users WHERE id = ?")
		.bind(userId)
		.first<{ totp_secret: string | null; totp_enabled: number; totp_last_step: number | null }>();
	if (!row?.totp_secret || (row.totp_enabled === 1) === Boolean(opts.pendingSecret)) return null;

	const step = await verifyTotp(row.totp_secret, code, row.totp_last_step);
	if (step !== null) {
		// Conditional update so two simultaneous requests can't both use the same code.
		const { meta } = await db
			.prepare("UPDATE users SET totp_last_step = ? WHERE id = ? AND (totp_last_step IS NULL OR totp_last_step < ?)")
			.bind(step, userId, step)
			.run();
		return meta.changes === 1 ? "totp" : null;
	}
	if (opts.allowRecovery) {
		const normalized = normalizeRecoveryCode(code);
		if (normalized.length !== 10) return null;
		const { meta } = await db
			.prepare("UPDATE recovery_codes SET used_at = ? WHERE user_id = ? AND code_hash = ? AND used_at IS NULL")
			.bind(now(), userId, await sha256Hex(normalized))
			.run();
		if (meta.changes > 0) return "recovery";
	}
	return null;
}

/** Replaces the user's recovery codes; returns the new codes to show once. */
export async function issueRecoveryCodes(db: D1Database, userId: number) {
	const codes = newRecoveryCodes();
	const hashes = await Promise.all(codes.map((c) => sha256Hex(normalizeRecoveryCode(c))));
	await db.batch([
		db.prepare("DELETE FROM recovery_codes WHERE user_id = ?").bind(userId),
		...hashes.map((h) => db.prepare("INSERT INTO recovery_codes (user_id, code_hash) VALUES (?, ?)").bind(userId, h)),
	]);
	return codes;
}

export async function remainingRecoveryCodes(db: D1Database, userId: number) {
	return (
		(await db
			.prepare("SELECT COUNT(*) AS n FROM recovery_codes WHERE user_id = ? AND used_at IS NULL")
			.bind(userId)
			.first<number>("n")) ?? 0
	);
}

/** Turns 2FA off and forgets the secret and recovery codes. */
export function clearTotp(db: D1Database, userId: number) {
	return [
		db.prepare("UPDATE users SET totp_secret = NULL, totp_enabled = 0, totp_last_step = NULL WHERE id = ?").bind(userId),
		db.prepare("DELETE FROM recovery_codes WHERE user_id = ?").bind(userId),
		db.prepare("DELETE FROM mfa_challenges WHERE user_id = ?").bind(userId),
	];
}
