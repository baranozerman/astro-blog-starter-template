// MCP server (Streamable HTTP, stateless, JSON responses) that exposes Composio tools to Claude.
// Add https://<site>/mcp/<MCP_SECRET> in Claude → Settings → Connectors → Add custom connector.
import type { APIRoute } from "astro";
import { composioConfig, executeTool, listTools } from "../../lib/composio";

export const prerender = false;

const SUPPORTED_PROTOCOL_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];
const SERVER_INFO = { name: "prodinox-composio", version: "1.0.0" };

type JsonRpcId = string | number | null;
interface JsonRpcRequest {
	jsonrpc: "2.0";
	id?: JsonRpcId;
	method: string;
	params?: Record<string, unknown>;
}

class RpcError extends Error {
	constructor(
		readonly code: number,
		message: string,
	) {
		super(message);
	}
}

const encoder = new TextEncoder();

async function secretMatches(given: string, expected: string) {
	const [a, b] = await Promise.all(
		[given, expected].map(async (v) => new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(v)))),
	);
	let diff = 0;
	for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
	return diff === 0;
}

const json = (body: unknown, status = 200) =>
	new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json", "cache-control": "no-store" },
	});

async function handle(env: Env, message: JsonRpcRequest): Promise<unknown> {
	const config = composioConfig(env);
	if (!config) throw new RpcError(-32603, "COMPOSIO_API_KEY is not configured on the server.");

	switch (message.method) {
		case "initialize": {
			const requested = String(message.params?.protocolVersion ?? "");
			return {
				protocolVersion: SUPPORTED_PROTOCOL_VERSIONS.includes(requested)
					? requested
					: SUPPORTED_PROTOCOL_VERSIONS[0],
				capabilities: { tools: { listChanged: false } },
				serverInfo: SERVER_INFO,
				instructions:
					"Tools come from Composio and act on the accounts connected in the Composio dashboard. " +
					"If a tool reports that no connected account exists, ask the user to connect that app in Composio.",
			};
		}
		case "ping":
			return {};
		case "tools/list": {
			const tools = await listTools(config);
			return {
				tools: tools.map((tool) => ({
					name: tool.slug,
					title: tool.name,
					description: tool.description,
					inputSchema: tool.inputSchema,
					annotations: { title: tool.name, ...tool.hints },
				})),
			};
		}
		case "tools/call": {
			const name = String(message.params?.name ?? "");
			const args = (message.params?.arguments ?? {}) as Record<string, unknown>;
			const tool = (await listTools(config)).find((t) => t.slug === name);
			if (!tool) throw new RpcError(-32602, `Unknown tool: ${name}`);
			try {
				const result = await executeTool(config, tool, args);
				const text = result.successful
					? JSON.stringify(result.data ?? {}, null, 2)
					: `Error: ${result.error ?? "Tool execution failed"}`;
				return { content: [{ type: "text", text }], isError: !result.successful };
			} catch (err) {
				// Tool failures are reported to the model, not as protocol errors.
				return { content: [{ type: "text", text: String((err as Error).message) }], isError: true };
			}
		}
		default:
			throw new RpcError(-32601, `Method not found: ${message.method}`);
	}
}

export const POST: APIRoute = async ({ params, request, locals }) => {
	const env = locals.runtime.env;
	if (!env.MCP_SECRET || !(await secretMatches(params.token ?? "", env.MCP_SECRET))) {
		return new Response("Not found", { status: 404 });
	}

	let message: JsonRpcRequest;
	try {
		message = await request.json();
	} catch {
		return json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }, 400);
	}
	if (!message || typeof message !== "object" || Array.isArray(message) || typeof message.method !== "string") {
		return json({ jsonrpc: "2.0", id: null, error: { code: -32600, message: "Invalid request" } }, 400);
	}

	// Notifications (no id) need no response body.
	if (message.id === undefined) return new Response(null, { status: 202 });

	try {
		return json({ jsonrpc: "2.0", id: message.id, result: await handle(env, message) });
	} catch (err) {
		const code = err instanceof RpcError ? err.code : -32603;
		return json({ jsonrpc: "2.0", id: message.id, error: { code, message: (err as Error).message } });
	}
};

// Stateless server: no server-initiated SSE stream and no sessions to delete.
export const GET: APIRoute = () => new Response("Method not allowed", { status: 405, headers: { allow: "POST" } });
export const DELETE: APIRoute = GET;
