/**
 * Full-screen background photos (WeTransfer-style), taken from the Prodinox
 * company presentation. Each entry needs public/backgrounds/<file>.jpg
 * (~2400px wide) and <file>-1200.jpg for phones. `focus` is the CSS
 * object-position that keeps the subject in view when the photo is cropped.
 */
export const BACKDROPS = [
	{ file: "laser", caption: "CNC lazer kesim", focus: "68% 50%" },
	{ file: "campaign", caption: "Meet beyond the visible.", focus: "58% 40%" },
	{ file: "hall", caption: "Yeni 7.500 m² üretim tesisimiz", focus: "50% 45%" },
	{ file: "factory", caption: "Prodinox fabrikası", focus: "55% 55%" },
	{ file: "operator", caption: "Üretimde CNC operasyonu", focus: "55% 35%" },
];

export type Backdrop = (typeof BACKDROPS)[number];

/** Rotates daily so the background stays the same while someone navigates. */
export function todaysBackdrop(): Backdrop {
	const day = Math.floor(Date.now() / 86_400_000);
	return BACKDROPS[day % BACKDROPS.length];
}
