const mcpPort = process.env.MCP_PORT || "8001";
const BASE = process.env.MCP_BASE_URL || `http://localhost:${mcpPort}`;
const email = process.env.PLUMRR_EMAIL;
const password = process.env.PLUMRR_PASSWORD;

const HEADERS = {
  "Content-Type": "application/json",
  Accept: "application/json, text/event-stream",
};

function parseSSE(text) {
  const lines = text.split("\n");
  for (const line of lines) {
    if (line.startsWith("data: ")) {
      return JSON.parse(line.slice(6));
    }
  }
  return JSON.parse(text);
}

async function mcpRequest(method, params, id, sessionId) {
  const body = { jsonrpc: "2.0", id, method, params: params || {} };
  const headers = { ...HEADERS };
  if (sessionId) headers["mcp-session-id"] = sessionId;
  const resp = await fetch(`${BASE}/mcp`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  const text = await resp.text();
  const json = parseSSE(text);
  return { resp, json, sessionId: resp.headers.get("mcp-session-id") };
}

async function mcpNotify(method, params, sessionId) {
  const body = { jsonrpc: "2.0", method, params: params || {} };
  await fetch(`${BASE}/mcp`, {
    method: "POST",
    headers: { ...HEADERS, "mcp-session-id": sessionId },
    body: JSON.stringify(body),
  });
}

async function main() {
  let pass = 0;
  let fail = 0;

  function check(label, condition) {
    if (condition) {
      console.log(`  PASS: ${label}`);
      pass++;
    } else {
      console.log(`  FAIL: ${label}`);
      fail++;
    }
  }

  console.log("1. Initialize");
  const init = await mcpRequest(
    "initialize",
    {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "test", version: "1.0.0" },
    },
    1
  );
  const sessionId = init.sessionId;
  check("got session id", !!sessionId);
  check(
    "server info returned",
    init.json?.result?.serverInfo?.name === "plumrr-api-mcp"
  );

  await mcpNotify("notifications/initialized", {}, sessionId);

  console.log("2. List tools");
  const tools = await mcpRequest("tools/list", {}, 2, sessionId);
  const toolNames = tools.json?.result?.tools?.map((t) => t.name) || [];
  check("tools returned", toolNames.length > 0);
  check(
    "auth_login exists",
    toolNames.includes("auth_login")
  );
  check(
    "customers_list exists",
    toolNames.includes("customers_list")
  );
  check(
    "mrr_get_customer_data exists",
    toolNames.includes("mrr_get_customer_data")
  );
  console.log(`   Tool count: ${toolNames.length}`);

  console.log("3. Login");
  const login = await mcpRequest(
    "tools/call",
    { name: "auth_login", arguments: { email, password } },
    3,
    sessionId
  );
  const loginContent = JSON.parse(login.json.result.content[0].text);
  check("login status 200", loginContent.status === 200);
  check("setCookie present", loginContent.setCookie?.length >= 2);
  const cookies = loginContent.setCookie.map((c) => c.split(";")[0]).join("; ");

  console.log("4. Auth me");
  const me = await mcpRequest(
    "tools/call",
    { name: "auth_me", arguments: { cookieHeader: cookies } },
    4,
    sessionId
  );
  const meContent = JSON.parse(me.json.result.content[0].text);
  check("me status 200", meContent.status === 200);
  check("me has email", !!meContent.body?.email);

  console.log("5. Customers list");
  const cust = await mcpRequest(
    "tools/call",
    { name: "customers_list", arguments: { cookieHeader: cookies } },
    5,
    sessionId
  );
  const custContent = JSON.parse(cust.json.result.content[0].text);
  check("customers status 200", custContent.status === 200);

  console.log("6. Reports filter options");
  const reports = await mcpRequest(
    "tools/call",
    {
      name: "reports_get_filter_options",
      arguments: { cookieHeader: cookies },
    },
    6,
    sessionId
  );
  const reportsContent = JSON.parse(reports.json.result.content[0].text);
  check("reports status 200", reportsContent.status === 200);

  console.log("7. Auth refresh");
  const refresh = await mcpRequest(
    "tools/call",
    { name: "auth_refresh", arguments: { cookieHeader: cookies } },
    7,
    sessionId
  );
  const refreshContent = JSON.parse(refresh.json.result.content[0].text);
  check("refresh status 200", refreshContent.status === 200);
  check("refresh setCookie present", refreshContent.setCookie?.length >= 1);

  console.log(`\nResults: ${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
