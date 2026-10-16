type Runtime = import("@astrojs/cloudflare").Runtime<Env>;

interface Env {
  /** Secret required to create the first admin account at /portal/setup. */
  SETUP_TOKEN?: string;
}

declare namespace App {
  interface Locals extends Runtime {
    user: import("./lib/auth").SessionUser | null;
  }
}
