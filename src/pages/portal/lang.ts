import type { APIRoute } from "astro";
import { LANG_COOKIE } from "../../lib/i18n";
import { safeNext } from "../../lib/portal";

export const prerender = false;

/** Switches the interface language and returns to the page the user was on. */
export const GET: APIRoute = ({ url, cookies, redirect }) => {
	const lang = url.searchParams.get("to") === "en" ? "en" : "tr";
	cookies.set(LANG_COOKIE, lang, {
		path: "/",
		maxAge: 60 * 60 * 24 * 365,
		sameSite: "lax",
		secure: url.protocol === "https:",
	});
	return redirect(safeNext(url.searchParams.get("next")));
};
