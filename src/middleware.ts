import { defineMiddleware } from "astro:middleware";
import { SESSION_COOKIE, getSessionUser } from "./lib/auth";
import { LANG_COOKIE, detectLang, translator } from "./lib/i18n";
import { ensureSchema } from "./lib/schema";

const PUBLIC_PATHS = new Set(["/portal/login", "/portal/setup", "/portal/lang"]);

export const onRequest = defineMiddleware(async (context, next) => {
	context.locals.user = null;
	context.locals.lang = detectLang(
		context.cookies.get(LANG_COOKIE)?.value,
		context.request.headers.get("Accept-Language"),
	);
	context.locals.t = translator(context.locals.lang);
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
