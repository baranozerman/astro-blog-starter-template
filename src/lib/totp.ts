/**
 * Two-factor authentication: TOTP (RFC 6238, as used by Google/Microsoft
 * Authenticator) plus single-use recovery codes.
 */

const STEP_SECONDS = 30;
const DIGITS = 6;
const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
// Recovery codes avoid look-alike characters (0/o, 1/l/i).
const RECOVERY_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
export const RECOVERY_CODE_COUNT = 10;

function base32Encode(bytes: Uint8Array) {
	let bits = 0;
	let value = 0;
	let out = "";
	for (const b of bytes) {
		value = (value << 8) | b;
		bits += 8;
		while (bits >= 5) {
			out += BASE32[(value >>> (bits - 5)) & 31];
			bits -= 5;
		}
	}
	if (bits > 0) out += BASE32[(value << (5 - bits)) & 31];
	return out;
}

function base32Decode(text: string) {
	const clean = text.toUpperCase().replace(/[^A-Z2-7]/g, "");
	const out: number[] = [];
	let bits = 0;
	let value = 0;
	for (const c of clean) {
		value = (value << 5) | BASE32.indexOf(c);
		bits += 5;
		if (bits >= 8) {
			out.push((value >>> (bits - 8)) & 255);
			bits -= 8;
		}
	}
	return new Uint8Array(out);
}

/** A new random 160-bit secret, base32 encoded. */
export function newTotpSecret() {
	return base32Encode(crypto.getRandomValues(new Uint8Array(20)));
}

/** The otpauth:// URI authenticator apps read from the QR code. */
export function totpUri(secret: string, account: string, issuer = "Prodinox Portal") {
	const label = encodeURIComponent(`${issuer}:${account}`);
	const params = new URLSearchParams({ secret, issuer, algorithm: "SHA1", digits: String(DIGITS), period: String(STEP_SECONDS) });
	return `otpauth://totp/${label}?${params}`;
}

/** "ABCD EFGH ..." for typing the key in by hand. */
export function formatSecret(secret: string) {
	return secret.replace(/(.{4})/g, "$1 ").trim();
}

async function hotp(secret: string, counter: number) {
	const key = await crypto.subtle.importKey("raw", base32Decode(secret), { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
	const msg = new DataView(new ArrayBuffer(8));
	msg.setUint32(0, Math.floor(counter / 2 ** 32));
	msg.setUint32(4, counter >>> 0);
	const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, msg.buffer));
	const offset = mac[mac.length - 1] & 15;
	const code =
		(((mac[offset] & 127) << 24) | (mac[offset + 1] << 16) | (mac[offset + 2] << 8) | mac[offset + 3]) %
		10 ** DIGITS;
	return String(code).padStart(DIGITS, "0");
}

/**
 * Checks a 6-digit code, allowing one step of clock drift either way.
 * Returns the matched time step (store it to reject replays), or null.
 */
export async function verifyTotp(secret: string, code: string, lastStep: number | null, at = Date.now()) {
	const digits = code.replace(/\s+/g, "");
	if (!/^\d{6}$/.test(digits)) return null;
	const current = Math.floor(at / 1000 / STEP_SECONDS);
	for (const step of [current - 1, current, current + 1]) {
		if (lastStep !== null && step <= lastStep) continue;
		if ((await hotp(secret, step)) === digits) return step;
	}
	return null;
}

/** New recovery codes in "xxxxx-xxxxx" form (50 bits each). */
export function newRecoveryCodes() {
	return Array.from({ length: RECOVERY_CODE_COUNT }, () => {
		const chars = Array.from(crypto.getRandomValues(new Uint8Array(10)), (b) => RECOVERY_ALPHABET[b % RECOVERY_ALPHABET.length]);
		return `${chars.slice(0, 5).join("")}-${chars.slice(5).join("")}`;
	});
}

/** Canonical form for hashing: lowercase letters and digits only. */
export function normalizeRecoveryCode(code: string) {
	return code.toLowerCase().replace(/[^a-z0-9]/g, "");
}
