import type { APIRoute } from "astro";
import { destroySession } from "../../lib/auth";

export const prerender = false;

export const POST: APIRoute = async ({ locals, cookies, redirect }) => {
	await destroySession(locals.runtime.env.DB, cookies);
	return redirect("/portal/login");
};
