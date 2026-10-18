/**
 * Full-screen background photos (WeTransfer-style), taken from the Prodinox
 * company presentation. Each entry needs public/backgrounds/<file>.jpg
 * (~2400px wide) and <file>-1200.jpg for phones. `focus` is the CSS
 * object-position that keeps the subject in view when the photo is cropped.
 * `caption` is a translation key (see i18n.ts).
 */
import type { MessageKey } from "./i18n";

export const BACKDROPS = [
	{ file: "laser", caption: "bg.laser", focus: "68% 50%" },
	{ file: "campaign", caption: "bg.campaign", focus: "58% 40%" },
	{ file: "hall", caption: "bg.hall", focus: "50% 45%" },
	{ file: "factory", caption: "bg.factory", focus: "55% 55%" },
	{ file: "operator", caption: "bg.operator", focus: "55% 35%" },
] as const satisfies readonly { file: string; caption: MessageKey; focus: string }[];

export type Backdrop = (typeof BACKDROPS)[number];

/** Rotates daily so the background stays the same while someone navigates. */
export function todaysBackdrop(): Backdrop {
	const day = Math.floor(Date.now() / 86_400_000);
	return BACKDROPS[day % BACKDROPS.length];
}
