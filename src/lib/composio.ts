// Minimal client for the Composio REST API (v3.1), used by the /mcp connector.

const API_BASE = "https://backend.composio.dev/api/v3.1";
const TOOLS_CACHE_TTL_MS = 5 * 60 * 1000;

export interface ComposioConfig {
	apiKey: string;
	/** Composio user whose connected accounts the tools run as. */
	userId: string;
	/** Toolkit slugs to expose, e.g. ["gmail", "googlesheets"]. */
	toolkits: string[];
	/** Optional explicit tool slugs; when set, only these tools are exposed. */
	tools: string[];
}

export interface ComposioTool {
	slug: string;
	name: string;
	description: string;
	version: string;
	inputSchema: Record<string, unknown>;
	/** MCP tool hints Composio publishes as tags, e.g. readOnlyHint, destructiveHint. */
	hints: Record<string, boolean>;
}

interface ToolListItem {
	slug: string;
	name: string;
	description: string;
	version: string;
	input_parameters: Record<string, unknown>;
	tags?: string[];
	toolkit?: { slug: string };
}

interface ToolListResponse {
	items: ToolListItem[];
	next_cursor?: string | null;
}

export interface ExecuteResult {
	successful: boolean;
	data: unknown;
	error: string | null;
}

const splitList = (value: string | undefined) =>
	(value ?? "")
		.split(",")
		.map((s) => s.trim())
		.filter(Boolean);

export function composioConfig(env: Env): ComposioConfig | null {
	if (!env.COMPOSIO_API_KEY) return null;
	return {
		apiKey: env.COMPOSIO_API_KEY,
		userId: env.COMPOSIO_USER_ID || "default",
		toolkits: splitList(env.COMPOSIO_TOOLKITS).map((s) => s.toLowerCase()),
		tools: splitList(env.COMPOSIO_TOOLS).map((s) => s.toUpperCase()),
	};
}

async function request<T>(config: ComposioConfig, path: string, init: RequestInit = {}): Promise<T> {
	const response = await fetch(`${API_BASE}${path}`, {
		...init,
		headers: { "x-api-key": config.apiKey, "content-type": "application/json", ...init.headers },
	});
	const text = await response.text();
	if (!response.ok) {
		throw new Error(`Composio API ${response.status}: ${text.slice(0, 500)}`);
	}
	return JSON.parse(text) as T;
}

async function listPages(config: ComposioConfig, filter: Record<string, string>) {
	const items: ToolListItem[] = [];
	let cursor: string | null | undefined;
	do {
		const query = new URLSearchParams({ ...filter, limit: "1000", toolkit_versions: "latest" });
		if (cursor) query.set("cursor", cursor);
		const page = await request<ToolListResponse>(config, `/tools?${query}`);
		items.push(...page.items);
		cursor = page.next_cursor;
	} while (cursor);
	return items;
}

const HINT_TAGS = ["readOnlyHint", "destructiveHint", "idempotentHint", "openWorldHint"];

function toTool(item: ToolListItem): ComposioTool {
	const schema = item.input_parameters ?? {};
	return {
		slug: item.slug,
		name: item.name,
		description: item.description,
		version: item.version,
		// MCP requires an object schema at the top level.
		inputSchema: { ...schema, type: "object", properties: schema.properties ?? {} },
		hints: Object.fromEntries(
			HINT_TAGS.filter((hint) => item.tags?.includes(hint)).map((hint) => [hint, true]),
		),
	};
}

let cache: { key: string; expires: number; tools: ComposioTool[] } | null = null;

/** Tools exposed to Claude: the configured tool slugs, or every tool in the configured toolkits. */
export async function listTools(config: ComposioConfig): Promise<ComposioTool[]> {
	const key = JSON.stringify([config.apiKey.slice(-6), config.toolkits, config.tools]);
	if (cache && cache.key === key && cache.expires > Date.now()) return cache.tools;

	let items: ToolListItem[];
	if (config.tools.length > 0) {
		items = await listPages(config, { tool_slugs: config.tools.join(",") });
	} else {
		const pages = await Promise.all(config.toolkits.map((toolkit) => listPages(config, { toolkit_slug: toolkit })));
		items = pages.flat();
	}

	const seen = new Set<string>();
	const tools = items
		.filter((item) => !seen.has(item.slug) && seen.add(item.slug))
		.map(toTool);
	cache = { key, expires: Date.now() + TOOLS_CACHE_TTL_MS, tools };
	return tools;
}

export async function executeTool(
	config: ComposioConfig,
	tool: ComposioTool,
	args: Record<string, unknown>,
): Promise<ExecuteResult> {
	return request<ExecuteResult>(config, `/tools/execute/${encodeURIComponent(tool.slug)}`, {
		method: "POST",
		body: JSON.stringify({ user_id: config.userId, arguments: args, version: tool.version }),
	});
}
