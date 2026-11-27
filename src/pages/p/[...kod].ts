import type { APIRoute } from "astro";
import { projectCodePath } from "../../lib/portal";

export const prerender = false;

/**
 * Short public link printed as a QR code on Prodinox shipping labels:
 * /p/<project code> → the project's Data Book folder. Sign-in and access
 * checks happen under /portal (see src/pages/portal/p/[...kod].astro).
 */
export const GET: APIRoute = ({ params, redirect }) => {
	const code = String(params.kod ?? "");
	return redirect(`/portal/p/${projectCodePath(code)}`, 302);
};
