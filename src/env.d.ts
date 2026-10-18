type Runtime = import("@astrojs/cloudflare").Runtime<Env>;

interface Env {
  /** Secret required to create the first admin account at /portal/setup. */
  SETUP_TOKEN?: string;
  /** WebDAV folder on the company NAS, e.g. https://nas.example.com/portal. Unset = store in R2. */
  WEBDAV_URL?: string;
  WEBDAV_USER?: string;
  WEBDAV_PASSWORD?: string;
  /** Cloudflare Access service token protecting the NAS tunnel hostname. */
  CF_ACCESS_CLIENT_ID?: string;
  CF_ACCESS_CLIENT_SECRET?: string;
}

declare namespace App {
  interface Locals extends Runtime {
    user: import("./lib/auth").SessionUser | null;
    lang: import("./lib/i18n").Lang;
    t: import("./lib/i18n").Translate;
  }
}
