type Runtime = import("@astrojs/cloudflare").Runtime<Env>;

interface Env {
  /** Secret required to create the first admin account at /portal/setup. */
  SETUP_TOKEN?: string;
  /** Secret path segment for the Claude connector: https://<site>/mcp/<MCP_SECRET>. */
  MCP_SECRET?: string;
  /** Composio API key (Composio dashboard → Settings → API Keys). */
  COMPOSIO_API_KEY?: string;
  /** Composio user id whose connected accounts the tools use (default: "default"). */
  COMPOSIO_USER_ID?: string;
  /** Comma-separated toolkit slugs to expose, e.g. "gmail,googlesheets". */
  COMPOSIO_TOOLKITS?: string;
  /** Optional comma-separated tool slugs; when set, only these tools are exposed. */
  COMPOSIO_TOOLS?: string;
}

declare namespace App {
  interface Locals extends Runtime {
    user: import("./lib/auth").SessionUser | null;
  }
}
