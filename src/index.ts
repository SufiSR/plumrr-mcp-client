import express from "express";
import { randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { getConfig } from "./config.js";
import { registerTools } from "./tools.js";

const config = getConfig();
const app = express();

app.use(express.json({ limit: "1mb" }));

const sessions = new Map<string, { server: McpServer; transport: StreamableHTTPServerTransport }>();

function createSession(): { server: McpServer; transport: StreamableHTTPServerTransport; sessionId: string } {
  const sessionId = randomUUID();
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => sessionId
  });

  const server = new McpServer(
    { name: "plumrr-api-mcp", version: "0.1.0" },
    {
      instructions:
        "Stateless PluMRR MCP bridge. " +
        "Use auth_login with email/password to obtain Set-Cookie values. " +
        "Pass the returned cookieHeader to all subsequent tool calls. " +
        "Never inject Authorization: Bearer for user-login endpoints. " +
        "IMPORTANT: Most contract, MRR, and loss tools require a numeric customerId. " +
        "When the user refers to a customer by name, ALWAYS call customers_list first, " +
        "find the best matching customer name in the results, extract its id, " +
        "and then use that id for the subsequent tool call."
    }
  );

  registerTools({ server, apiBaseUrl: config.PLUMRR_API_BASE_URL });
  sessions.set(sessionId, { server, transport });

  transport.onclose = () => {
    sessions.delete(sessionId);
  };

  return { server, transport, sessionId };
}

app.get("/health", (_req, res) => {
  res.status(200).json({ ok: true, service: "plumrr-mcp-client" });
});

app.post("/mcp", async (req, res) => {
  const existingSessionId = req.headers["mcp-session-id"] as string | undefined;

  if (existingSessionId) {
    const session = sessions.get(existingSessionId);
    if (!session) {
      res.status(404).json({ jsonrpc: "2.0", error: { code: -32000, message: "Session not found. Re-initialize." }, id: null });
      return;
    }
    await session.transport.handleRequest(req, res, req.body);
    return;
  }

  if (isInitializeRequest(req.body)) {
    const { server, transport } = createSession();
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
    return;
  }

  res.status(400).json({ jsonrpc: "2.0", error: { code: -32600, message: "No session. Send initialize first." }, id: null });
});

app.get("/mcp", async (req, res) => {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;
  if (!sessionId) {
    res.status(400).json({ jsonrpc: "2.0", error: { code: -32600, message: "Missing mcp-session-id header." }, id: null });
    return;
  }
  const session = sessions.get(sessionId);
  if (!session) {
    res.status(404).json({ jsonrpc: "2.0", error: { code: -32000, message: "Session not found." }, id: null });
    return;
  }
  await session.transport.handleRequest(req, res);
});

app.delete("/mcp", async (req, res) => {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;
  if (!sessionId) {
    res.status(400).json({ jsonrpc: "2.0", error: { code: -32600, message: "Missing mcp-session-id header." }, id: null });
    return;
  }
  const session = sessions.get(sessionId);
  if (session) {
    await session.transport.close();
    sessions.delete(sessionId);
  }
  res.status(200).json({ ok: true });
});

app.use((_req, res) => {
  res.status(404).json({ error: "Not found" });
});

app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const message = err instanceof Error ? err.message : "Internal server error";
  console.error("Unhandled error:", message);
  res.status(500).json({ error: message });
});

app.listen(config.MCP_PORT, () => {
  console.log(`plumrr-mcp-client listening on ${config.MCP_PORT}`);
});
