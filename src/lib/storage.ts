/**
 * File storage backends. New uploads go to the company NAS over WebDAV when
 * WEBDAV_URL is configured, otherwise to R2. The backend is recorded as a
 * prefix on the stored key ("webdav:<path>", anything else is R2), so files
 * uploaded before switching stay readable.
 */

export type StorageKind = "r2" | "webdav";

export interface Storage {
	kind: StorageKind;
	put(key: string, file: File, contentType: string): Promise<void>;
	get(key: string): Promise<ReadableStream | null>;
	delete(keys: string[]): Promise<void>;
}

export class StorageError extends Error {}

class R2Storage implements Storage {
	kind = "r2" as const;
	constructor(private bucket: R2Bucket) {}

	async put(key: string, file: File, contentType: string) {
		await this.bucket.put(key, file, { httpMetadata: { contentType } });
	}

	async get(key: string) {
		const object = await this.bucket.get(key);
		return object ? object.body : null;
	}

	async delete(keys: string[]) {
		// R2 bulk delete accepts at most 1000 keys per call.
		for (let i = 0; i < keys.length; i += 1000) {
			await this.bucket.delete(keys.slice(i, i + 1000));
		}
	}
}

class WebDavStorage implements Storage {
	kind = "webdav" as const;
	private base: string;
	private headers: Record<string, string>;

	constructor(env: Env) {
		this.base = env.WEBDAV_URL!.replace(/\/+$/, "");
		this.headers = {
			Authorization: `Basic ${btoa(`${env.WEBDAV_USER ?? ""}:${env.WEBDAV_PASSWORD ?? ""}`)}`,
		};
		// Service token for a Cloudflare Access policy in front of the tunnel.
		if (env.CF_ACCESS_CLIENT_ID && env.CF_ACCESS_CLIENT_SECRET) {
			this.headers["CF-Access-Client-Id"] = env.CF_ACCESS_CLIENT_ID;
			this.headers["CF-Access-Client-Secret"] = env.CF_ACCESS_CLIENT_SECRET;
		}
	}

	private url(key: string) {
		return `${this.base}/${key.split("/").map(encodeURIComponent).join("/")}`;
	}

	private async request(method: string, key: string, init: RequestInit = {}) {
		try {
			const res = await fetch(this.url(key), {
				...init,
				method,
				headers: { ...this.headers, ...(init.headers as Record<string, string>) },
				redirect: "manual",
			});
			// Only GET bodies are used; drain the rest so the connection is released.
			if (method !== "GET") await res.body?.cancel();
			return res;
		} catch (e) {
			throw new StorageError(`Dosya sunucusuna ulaşılamadı: ${(e as Error).message}`);
		}
	}

	async put(key: string, file: File, contentType: string) {
		// Create parent collections one level at a time; 405 means it already exists.
		const parts = key.split("/").slice(0, -1);
		for (let i = 1; i <= parts.length; i++) {
			const res = await this.request("MKCOL", `${parts.slice(0, i).join("/")}/`);
			if (!res.ok && res.status !== 405) {
				throw new StorageError(`Klasör oluşturulamadı (${res.status}).`);
			}
		}
		const res = await this.request("PUT", key, {
			body: file,
			headers: { "Content-Type": contentType },
		});
		if (!res.ok) throw new StorageError(`Dosya yüklenemedi (${res.status}).`);
	}

	async get(key: string) {
		const res = await this.request("GET", key);
		if (res.status === 404) return null;
		if (!res.ok || !res.body) throw new StorageError(`Dosya okunamadı (${res.status}).`);
		return res.body;
	}

	async delete(keys: string[]) {
		for (const key of keys) {
			const res = await this.request("DELETE", key);
			if (!res.ok && res.status !== 404) {
				throw new StorageError(`Dosya silinemedi (${res.status}).`);
			}
		}
	}
}

const WEBDAV_PREFIX = "webdav:";

function getStorage(env: Env, kind: StorageKind): Storage {
	if (kind === "webdav") {
		if (!env.WEBDAV_URL) throw new StorageError("WEBDAV_URL tanımlı değil.");
		return new WebDavStorage(env);
	}
	return new R2Storage(env.FILES);
}

/** Splits a stored key into its backend and the key inside that backend. */
export function resolveKey(env: Env, storedKey: string) {
	return storedKey.startsWith(WEBDAV_PREFIX)
		? { storage: getStorage(env, "webdav"), key: storedKey.slice(WEBDAV_PREFIX.length) }
		: { storage: getStorage(env, "r2"), key: storedKey };
}

/**
 * Stores an upload in the active backend and returns the key to save in the database.
 * NAS paths stay readable: <folder id>/<date>_<short id>_<file name>.
 */
export async function storeUpload(env: Env, folderId: number, fileName: string, file: File, contentType: string) {
	const kind: StorageKind = env.WEBDAV_URL ? "webdav" : "r2";
	const date = new Date().toISOString().slice(0, 10);
	const path = `${folderId}/${date}_${crypto.randomUUID().slice(0, 8)}_${fileName}`;
	const storedKey = kind === "webdav" ? WEBDAV_PREFIX + path : `folders/${path}`;
	const { storage, key } = resolveKey(env, storedKey);
	await storage.put(key, file, contentType);
	return storedKey;
}

/** Deletes stored files, grouping keys by backend. */
export async function deleteStored(env: Env, storedKeys: string[]) {
	const groups = new Map<StorageKind, { storage: Storage; keys: string[] }>();
	for (const storedKey of storedKeys) {
		const { storage, key } = resolveKey(env, storedKey);
		const group = groups.get(storage.kind) ?? { storage, keys: [] };
		group.keys.push(key);
		groups.set(storage.kind, group);
	}
	for (const { storage, keys } of groups.values()) await storage.delete(keys);
}
