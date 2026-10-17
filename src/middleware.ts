import { defineMiddleware } from "astro:middleware";
import { SESSION_COOKIE, getSessionUser } from "./lib/auth";
import { ensureSchema } from "./lib/schema";

const PUBLIC_PATHS = new Set(["/portal/login", "/portal/setup"]);

export const onRequest = defineMiddleware(async (context, next) => {
	context.locals.user = null;
	const path = context.url.pathname.replace(/\/+$/, "") || "/";
	if (path !== "/portal" && !path.startsWith("/portal/")) return next();

	const { DB } = context.locals.runtime.env;
	await ensureSchema(DB);
	const token = context.cookies.get(SESSION_COOKIE)?.value;
	const user = token ? await getSessionUser(DB, token) : null;
	context.locals.user = user;

	if (!user && !PUBLIC_PATHS.has(path)) {
		return context.redirect(`/portal/login?next=${encodeURIComponent(context.url.pathname)}`);
	}
	if (path.startsWith("/portal/admin") && user?.role !== "admin") {
		return context.redirect("/portal?err=forbidden");
	}

	const response = await next();
	// Portal pages contain private data; never let browsers or proxies cache them.
	try {
		response.headers.set("Cache-Control", "private, no-store");
		response.headers.set("X-Frame-Options", "DENY");
		response.headers.set("Referrer-Policy", "same-origin");
	} catch {
		// Some responses (e.g. redirects) have immutable headers.
	}
	return response;
});
