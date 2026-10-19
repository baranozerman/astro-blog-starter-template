import { defineMiddleware } from "astro:middleware";
import { SESSION_COOKIE, getSessionUser } from "./lib/auth";
import { LANG_COOKIE, detectLang, translator } from "./lib/i18n";
import { ensureSchema } from "./lib/schema";

const PUBLIC_PATHS = new Set(["/portal/login", "/portal/login/verify", "/portal/setup", "/portal/lang", "/portal/privacy"]);

// Everything the portal loads comes from this origin. Inline scripts/styles are
// Astro's own (define:vars, style attributes); nothing third-party is allowed.
const PORTAL_CSP = [
	"default-src 'self'",
	"script-src 'self' 'unsafe-inline'",
	"style-src 'self' 'unsafe-inline'",
	"img-src 'self' data: blob:",
	"font-src 'self'",
	"connect-src 'self'",
	"object-src 'none'",
	"base-uri 'self'",
	"form-action 'self'",
	"frame-ancestors 'none'",
].join("; ");

function secure(response: Response, portal: boolean) {
	try {
		const h = response.headers;
		h.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
		h.set("X-Content-Type-Options", "nosniff");
		h.set("Referrer-Policy", "same-origin");
		h.set("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()");
		if (portal) {
			// Portal pages contain private data; never let browsers or proxies cache them.
			h.set("Cache-Control", "private, no-store");
			h.set("X-Frame-Options", "DENY");
			// File downloads set their own (stricter) policy.
			if (!h.has("Content-Security-Policy")) h.set("Content-Security-Policy", PORTAL_CSP);
		}
	} catch {
		// Some responses (e.g. redirects) have immutable headers.
	}
	return response;
}

export const onRequest = defineMiddleware(async (context, next) => {
	context.locals.user = null;
	context.locals.lang = detectLang(
		context.cookies.get(LANG_COOKIE)?.value,
		context.request.headers.get("Accept-Language"),
	);
	context.locals.t = translator(context.locals.lang);
	const path = context.url.pathname.replace(/\/+$/, "") || "/";
	if (path !== "/portal" && !path.startsWith("/portal/")) return secure(await next(), false);

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

	return secure(await next(), true);
});
