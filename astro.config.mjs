// @ts-check
import { defineConfig } from "astro/config";
import mdx from "@astrojs/mdx";
import sitemap from "@astrojs/sitemap";

import cloudflare from "@astrojs/cloudflare";

// https://astro.build/config
export default defineConfig({
	site: "https://prodinox.app",
	integrations: [mdx(), sitemap()],
	security: {
		// Rejects cross-site form posts to the portal (CSRF protection).
		checkOrigin: true,
	},
	adapter: cloudflare({
		platformProxy: {
			enabled: true,
		},
	}),
});
