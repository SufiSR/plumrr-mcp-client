import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { isAllowedGetPath } from "./allowlist.js";
import { callUpstreamApi, formatUpstreamError } from "./http.js";
import { getRequestAuthState } from "./requestContext.js";
import { resolveCookieHeader } from "./resolveAuth.js";
import { rankCustomersByQuery, type CustomerRow } from "./customerMatch.js";

type RegisterToolsArgs = {
  server: McpServer;
  apiBaseUrl: string;
};

const SAFE_PATH_SEGMENT = /^[a-zA-Z0-9_\-]+$/;

function assertSafeSegment(value: string | number, label: string): string {
  const str = String(value);
  if (!SAFE_PATH_SEGMENT.test(str)) {
    throw new Error(`Invalid ${label}: must be alphanumeric, dash, or underscore.`);
  }
  return str;
}

type QueryValue = string | number | boolean;

function withQuery(path: string, query?: Record<string, QueryValue>): string {
  if (!query || Object.keys(query).length === 0) {
    return path;
  }
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    params.set(key, String(value));
  }
  return `${path}?${params.toString()}`;
}

function stripQueryString(path: string): string {
  const idx = path.indexOf("?");
  return idx === -1 ? path : path.substring(0, idx);
}

async function executeGet(apiBaseUrl: string, path: string, cookieHeader?: string) {
  const cleanPath = stripQueryString(path);
  if (!isAllowedGetPath(cleanPath)) {
    throw new Error(`Path is not allowlisted: ${cleanPath}`);
  }
  const isEmbedPublic =
    cleanPath.startsWith("/api/v1/reports/embed/") || cleanPath.startsWith("/api/embed/");
  let resolvedCookie: string | undefined;
  try {
    resolvedCookie = await resolveCookieHeader(apiBaseUrl, cookieHeader);
  } catch (err) {
    if (isEmbedPublic && !cookieHeader?.trim()) {
      resolvedCookie = undefined;
    } else {
      throw err;
    }
  }
  const result = await callUpstreamApi(apiBaseUrl, {
    method: "GET",
    path,
    cookieHeader: resolvedCookie
  });
  if (!result.ok) {
    throw new Error(formatUpstreamError(result));
  }
  return {
    content: [{ type: "text" as const, text: JSON.stringify({ status: result.status, body: result.json }, null, 2) }]
  };
}

const CookieInput = z.object({
  cookieHeader: z.string().min(1).optional()
});

const CustomerListInput = z.object({
  searchTerm: z.string().min(1).optional(),
  limit: z.number().int().min(1).max(10000).optional(),
  cookieHeader: z.string().min(1).optional()
});

function parseCustomerListJson(json: unknown): CustomerRow[] {
  if (!Array.isArray(json)) {
    return [];
  }
  const out: CustomerRow[] = [];
  for (const row of json) {
    if (row && typeof row === "object" && "id" in row && "customer_name" in row) {
      const r = row as Record<string, unknown>;
      out.push({
        id: Number(r.id),
        customer_name: String(r.customer_name ?? ""),
        country: r.country as string | null | undefined,
        segment: r.segment as string | null | undefined,
        company_code: r.company_code as string | null | undefined,
        agency_type: r.agency_type as string | null | undefined,
        number_of_users: r.number_of_users as number | null | undefined,
        accounts_receivable: r.accounts_receivable as number | null | undefined
      });
    }
  }
  return out;
}

async function runCustomersList(
  apiBaseUrl: string,
  args: { searchTerm?: string; limit?: number; cookieHeader?: string }
) {
  const resolvedCookie = await resolveCookieHeader(apiBaseUrl, args.cookieHeader);
  const listLimit = args.limit ?? 100;

  if (!args.searchTerm?.trim()) {
    const path = withQuery("/api/v1/customers", { limit: listLimit });
    const result = await callUpstreamApi(apiBaseUrl, {
      method: "GET",
      path,
      cookieHeader: resolvedCookie
    });
    if (!result.ok) {
      throw new Error(formatUpstreamError(result));
    }
    return {
      content: [{ type: "text" as const, text: JSON.stringify({ status: result.status, body: result.json }, null, 2) }]
    };
  }

  const q = args.searchTerm.trim();
  const searchPath = withQuery("/api/v1/customers", { search: q, limit: 10000 });
  const searchResult = await callUpstreamApi(apiBaseUrl, {
    method: "GET",
    path: searchPath,
    cookieHeader: resolvedCookie
  });
  if (!searchResult.ok) {
    throw new Error(formatUpstreamError(searchResult));
  }

  let rows = parseCustomerListJson(searchResult.json);
  let ranked = rankCustomersByQuery(q, rows);
  const MIN_SCORE = 0.35;

  if (ranked.length === 0 || !ranked[0] || ranked[0].matchScore < MIN_SCORE) {
    const fullPath = withQuery("/api/v1/customers", { limit: 10000 });
    const fullResult = await callUpstreamApi(apiBaseUrl, {
      method: "GET",
      path: fullPath,
      cookieHeader: resolvedCookie
    });
    if (!fullResult.ok) {
      throw new Error(formatUpstreamError(fullResult));
    }
    rows = parseCustomerListJson(fullResult.json);
    ranked = rankCustomersByQuery(q, rows);
  }

  const top = ranked.slice(0, 15).map((c) => ({
    id: c.id,
    customer_name: c.customer_name,
    country: c.country,
    segment: c.segment,
    company_code: c.company_code,
    matchScore: Math.round(c.matchScore * 1000) / 1000
  }));

  const best = ranked[0];

  const payload = {
    status: 200,
    searchTerm: q,
    apiFilter: "Server-side LIKE search plus client-side fuzzy ranking for typos and partial names.",
    bestMatch: best
      ? {
          id: best.id,
          customer_name: best.customer_name,
          matchScore: Math.round(best.matchScore * 1000) / 1000
        }
      : null,
    fuzzyMatches: top,
    note:
      "Prefer bestMatch.id when matchScore is high (e.g. >= 0.85). If several rows are close, ask the user to confirm. " +
      "For follow-up tools (MRR, contracts), pass the chosen id as customerId."
  };

  return {
    content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }]
  };
}

const LoginInput = z.object({
  email: z.string().email().optional(),
  password: z.string().min(1).optional()
});

const CustomerIdInput = z.object({
  customerId: z.union([z.string().min(1), z.number().int().positive()]),
  cookieHeader: z.string().min(1).optional()
});

const LossIdInput = z.object({
  lossId: z.union([z.string().min(1), z.number().int().positive()]),
  cookieHeader: z.string().min(1).optional()
});

const ContractOrderCheckInput = z.object({
  customerId: z.union([z.string().min(1), z.number().int().positive()]),
  orderId: z.union([z.string().min(1), z.number().int().positive()]),
  cookieHeader: z.string().min(1).optional()
});

const ContractsCurrentInput = z.object({
  customerId: z.union([z.string().min(1), z.number().int().positive()]).optional(),
  customerName: z.string().min(1).optional(),
  cookieHeader: z.string().min(1).optional()
});

const ReportsEmbedInput = z.object({
  slug: z.string().min(1),
  query: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
  cookieHeader: z.string().min(1).optional(),
  useLegacyApiEmbedPath: z.boolean().optional()
});

export function registerTools({ server, apiBaseUrl }: RegisterToolsArgs): void {

  // ── Auth ────────────────────────────────────────────────────────────

  server.registerTool(
    "auth_login",
    {
      title: "Auth Login",
      description:
        "Authenticate a user with email and password against PluMRR. " +
        "Returns the user profile and Set-Cookie values. " +
        "If LibreChat already sends credential headers on MCP requests, you may omit email/password here. " +
        "Otherwise pass email and password, store the returned setCookie values, and pass them as cookieHeader in subsequent tool calls.",
      inputSchema: LoginInput.shape
    },
    async ({ email: emailArg, password: passwordArg }) => {
      const store = getRequestAuthState();
      const email = emailArg ?? store?.email;
      const password = passwordArg ?? store?.password;
      if (!email || !password) {
        throw new Error(
          "Provide email and password to auth_login, or configure LibreChat MCP headers (X-Plumrr-Email / X-Plumrr-Password)."
        );
      }
      const result = await callUpstreamApi(apiBaseUrl, {
        method: "POST",
        path: "/api/v1/auth/login",
        body: { email, password }
      });
      if (!result.ok) {
        throw new Error(formatUpstreamError(result));
      }
      return {
        content: [{
          type: "text",
          text: JSON.stringify({ status: result.status, user: result.json, setCookie: result.setCookie }, null, 2)
        }]
      };
    }
  );

  server.registerTool(
    "auth_refresh",
    {
      title: "Auth Refresh",
      description:
        "Refresh the access token cookie. " +
        "Call this when a protected endpoint returns 401. " +
        "Requires cookieHeader containing the refresh cookie from a previous auth_login call, " +
        "or credential headers from LibreChat (same as other tools). " +
        "Returns updated Set-Cookie values that the caller MUST store.",
      inputSchema: CookieInput.shape
    },
    async ({ cookieHeader }) => {
      const resolved = await resolveCookieHeader(apiBaseUrl, cookieHeader);
      const result = await callUpstreamApi(apiBaseUrl, {
        method: "POST",
        path: "/api/v1/auth/refresh",
        cookieHeader: resolved
      });
      if (!result.ok) {
        throw new Error(formatUpstreamError(result));
      }
      return {
        content: [{ type: "text", text: JSON.stringify({ status: result.status, body: result.json, setCookie: result.setCookie }, null, 2) }]
      };
    }
  );

  server.registerTool(
    "auth_logout",
    {
      title: "Auth Logout",
      description:
        "End the user session. " +
        "Pass cookieHeader from a previous login. " +
        "After calling this, previously stored cookies should be discarded.",
      inputSchema: CookieInput.shape
    },
    async ({ cookieHeader }) => {
      const resolved = await resolveCookieHeader(apiBaseUrl, cookieHeader);
      const result = await callUpstreamApi(apiBaseUrl, {
        method: "POST",
        path: "/api/v1/auth/logout",
        cookieHeader: resolved
      });
      if (!result.ok) {
        throw new Error(formatUpstreamError(result));
      }
      return {
        content: [{ type: "text", text: JSON.stringify({ status: result.status, body: result.json, setCookie: result.setCookie }, null, 2) }]
      };
    }
  );

  server.registerTool(
    "auth_me",
    {
      title: "Auth Me",
      description:
        "Get the currently authenticated user profile. " +
        "Requires cookieHeader from a previous auth_login, or LibreChat credential headers. " +
        "Returns user id, email, name, role, and account status.",
      inputSchema: CookieInput.shape
    },
    async ({ cookieHeader }) => {
      const resolved = await resolveCookieHeader(apiBaseUrl, cookieHeader);
      const result = await callUpstreamApi(apiBaseUrl, {
        method: "GET",
        path: "/api/v1/auth/me",
        cookieHeader: resolved
      });
      if (!result.ok) {
        throw new Error(formatUpstreamError(result));
      }
      return {
        content: [{ type: "text", text: JSON.stringify({ status: result.status, body: result.json }, null, 2) }]
      };
    }
  );

  // ── Contracts ───────────────────────────────────────────────────────

  server.registerTool(
    "contracts_get_all",
    {
      title: "Contracts: Get All",
      description:
        "List all contracts across all customers. " +
        "Use when the user wants a full overview of every contract in the system. " +
        "For a specific customer's contracts, use customers_list to find the customer ID first, " +
        "then use contracts_get_current_for_customer or other contract tools with that ID.",
      inputSchema: CookieInput.shape
    },
    async ({ cookieHeader }) => executeGet(apiBaseUrl, "/api/v1/contracts/all", cookieHeader)
  );

  server.registerTool(
    "contracts_get_current_for_customer",
    {
      title: "Contracts: Get Current For Customer",
      description:
        "Fetch the currently active contract for a single customer. " +
        "Accepts customerId (numeric ID) or customerName (exact name). " +
        "Preferred workflow: call customers_list first to find the exact customer ID or name, " +
        "then pass it here. Returns 404 if no active contract exists.",
      inputSchema: ContractsCurrentInput.shape
    },
    async ({ customerId, customerName, cookieHeader }) => {
      if (!customerId && !customerName) {
        throw new Error("Either customerId or customerName must be provided.");
      }
      const query: Record<string, QueryValue> = {};
      if (customerId !== undefined) {
        query.customer_id = assertSafeSegment(customerId, "customerId");
      }
      if (customerName !== undefined) {
        query.customer_name = customerName;
      }
      return executeGet(apiBaseUrl, withQuery("/api/v1/contracts/current", query), cookieHeader);
    }
  );

  server.registerTool(
    "contracts_list",
    {
      title: "Contracts: List",
      description:
        "List contracts from the contracts index. " +
        "Returns a paginated or filtered list depending on upstream defaults.",
      inputSchema: CookieInput.shape
    },
    async ({ cookieHeader }) => executeGet(apiBaseUrl, "/api/v1/contracts", cookieHeader)
  );

  server.registerTool(
    "contracts_get_customer_losses",
    {
      title: "Contracts: Customer Losses",
      description:
        "Get loss records tied to a specific customer's contract context. " +
        "Use when investigating churn or revenue loss for a customer. " +
        "If you only have a customer name, call customers_list first to resolve the ID. " +
        "Input: customerId (numeric customer ID).",
      inputSchema: CustomerIdInput.shape
    },
    async ({ customerId, cookieHeader }) => {
      const id = assertSafeSegment(customerId, "customerId");
      return executeGet(apiBaseUrl, `/api/v1/contracts/${id}/losses`, cookieHeader);
    }
  );

  server.registerTool(
    "contracts_get_customer_sanity_check",
    {
      title: "Contracts: Customer Sanity Check",
      description:
        "Run backend contract sanity checks for one customer. " +
        "Use to detect data inconsistencies in contract records. " +
        "If you only have a customer name, call customers_list first to resolve the ID. " +
        "Input: customerId (numeric customer ID).",
      inputSchema: CustomerIdInput.shape
    },
    async ({ customerId, cookieHeader }) => {
      const id = assertSafeSegment(customerId, "customerId");
      return executeGet(apiBaseUrl, `/api/v1/contracts/${id}/sanity-check`, cookieHeader);
    }
  );

  server.registerTool(
    "contracts_get_customer_order_items",
    {
      title: "Contracts: Customer Order Items",
      description:
        "Retrieve contract-relevant order items for a customer. " +
        "Use when you need line-item detail from a customer's orders that feed into contract calculations. " +
        "If you only have a customer name, call customers_list first to resolve the ID. " +
        "Input: customerId (numeric customer ID).",
      inputSchema: CustomerIdInput.shape
    },
    async ({ customerId, cookieHeader }) => {
      const id = assertSafeSegment(customerId, "customerId");
      return executeGet(apiBaseUrl, `/api/v1/contracts/${id}/order-items`, cookieHeader);
    }
  );

  server.registerTool(
    "contracts_get_customer_recurring_orders",
    {
      title: "Contracts: Customer Recurring Orders",
      description:
        "Fetch recurring orders for a customer used in contract processing. " +
        "Use when analyzing subscription or recurring revenue patterns for a customer. " +
        "If you only have a customer name, call customers_list first to resolve the ID. " +
        "Input: customerId (numeric customer ID).",
      inputSchema: CustomerIdInput.shape
    },
    async ({ customerId, cookieHeader }) => {
      const id = assertSafeSegment(customerId, "customerId");
      return executeGet(apiBaseUrl, `/api/v1/contracts/${id}/recurring-orders`, cookieHeader);
    }
  );

  server.registerTool(
    "contracts_get_customer_item_overrides",
    {
      title: "Contracts: Customer Item Overrides",
      description:
        "Fetch customer-specific item overrides used by contract logic. " +
        "Use when investigating why a customer's contract values differ from standard pricing. " +
        "If you only have a customer name, call customers_list first to resolve the ID. " +
        "Input: customerId (numeric customer ID).",
      inputSchema: CustomerIdInput.shape
    },
    async ({ customerId, cookieHeader }) => {
      const id = assertSafeSegment(customerId, "customerId");
      return executeGet(apiBaseUrl, `/api/v1/contracts/${id}/item-overrides`, cookieHeader);
    }
  );

  server.registerTool(
    "contracts_check_order_timeframes",
    {
      title: "Contracts: Check Order Timeframes",
      description:
        "Validate order timeframe consistency for a specific customer order. " +
        "Use when debugging date/period mismatches in contract order data. " +
        "If you only have a customer name, call customers_list first to resolve the ID. " +
        "Input: customerId and orderId (both numeric IDs).",
      inputSchema: ContractOrderCheckInput.shape
    },
    async ({ customerId, orderId, cookieHeader }) => {
      const cid = assertSafeSegment(customerId, "customerId");
      const oid = assertSafeSegment(orderId, "orderId");
      return executeGet(apiBaseUrl, `/api/v1/contracts/${cid}/orders/${oid}/check-timeframes`, cookieHeader);
    }
  );

  // ── MRR ─────────────────────────────────────────────────────────────

  server.registerTool(
    "mrr_get_customer_data",
    {
      title: "MRR: Get Customer Data",
      description:
        "Retrieve Monthly Recurring Revenue (MRR) data for one customer. " +
        "Use when analyzing revenue trends, MRR breakdown, or financial metrics for a specific customer. " +
        "If you only have a customer name, call customers_list first to resolve the ID. " +
        "Input: customerId (numeric customer ID).",
      inputSchema: CustomerIdInput.shape
    },
    async ({ customerId, cookieHeader }) => {
      const id = assertSafeSegment(customerId, "customerId");
      return executeGet(apiBaseUrl, `/api/v1/mrr/customer/${id}`, cookieHeader);
    }
  );

  // ── Customers ───────────────────────────────────────────────────────

  server.registerTool(
    "customers_list",
    {
      title: "Customers: List",
      description:
        "List or search customers. Uses API query params: search (name filter) and limit (1–10000, default 100 when not searching). " +
        "When searchTerm is set, calls the API with search=… and limit=10000, then applies fuzzy ranking so imperfect spelling still surfaces the best customer_name match (with matchScore). " +
        "IMPORTANT: Call with searchTerm when the user gives a company name; use bestMatch.id for MRR/contracts unless scores are ambiguous. " +
        "Optional limit applies when searchTerm is omitted (plain list).",
      inputSchema: CustomerListInput.shape
    },
    async (args) => runCustomersList(apiBaseUrl, args)
  );

  server.registerTool(
    "customers_get_by_id",
    {
      title: "Customers: Get By ID",
      description:
        "Fetch a single customer by their numeric ID. " +
        "Use when you already have the customer ID and need full customer details. " +
        "If you only have a customer name, call customers_list first to resolve the ID. " +
        "Input: customerId (numeric customer ID).",
      inputSchema: CustomerIdInput.shape
    },
    async ({ customerId, cookieHeader }) => {
      const id = assertSafeSegment(customerId, "customerId");
      return executeGet(apiBaseUrl, `/api/v1/customers/${id}`, cookieHeader);
    }
  );

  // ── Reports ─────────────────────────────────────────────────────────

  server.registerTool(
    "reports_get_filter_options",
    {
      title: "Reports: Filter Options",
      description:
        "Fetch available filter options for reports (time periods, categories, etc.). " +
        "Call this before other report tools to know which filters are available.",
      inputSchema: CookieInput.shape
    },
    async ({ cookieHeader }) => executeGet(apiBaseUrl, "/api/v1/reports/filter-options", cookieHeader)
  );

  server.registerTool(
    "reports_get_customer_world_map",
    {
      title: "Reports: Customer World Map",
      description:
        "Fetch geographic distribution data for customers. " +
        "Use when the user asks about customer locations, geographic breakdown, or regional analysis.",
      inputSchema: CookieInput.shape
    },
    async ({ cookieHeader }) => executeGet(apiBaseUrl, "/api/v1/reports/customer-world-map", cookieHeader)
  );

  server.registerTool(
    "reports_get_lorenz_curve_filter_options",
    {
      title: "Reports: Lorenz Curve Filter Options",
      description:
        "Fetch filter options specific to the Lorenz curve (revenue concentration) report. " +
        "Use before requesting Lorenz curve data to know which filters apply.",
      inputSchema: CookieInput.shape
    },
    async ({ cookieHeader }) => executeGet(apiBaseUrl, "/api/v1/reports/lorenz-curve/filter-options", cookieHeader)
  );

  server.registerTool(
    "reports_get_lost_won_customers",
    {
      title: "Reports: Lost/Won Customers",
      description:
        "Fetch analytics data on lost and won customers. " +
        "Use when the user asks about customer churn, new customer acquisition, or win/loss analysis.",
      inputSchema: CookieInput.shape
    },
    async ({ cookieHeader }) => executeGet(apiBaseUrl, "/api/v1/reports/lost-won-customers", cookieHeader)
  );

  server.registerTool(
    "reports_get_lost_won_customers_status",
    {
      title: "Reports: Lost/Won Customers Status",
      description:
        "Fetch status metadata for the lost/won customer report (e.g. last generated, processing state). " +
        "Use to check if the lost/won report data is current before displaying it.",
      inputSchema: CookieInput.shape
    },
    async ({ cookieHeader }) => executeGet(apiBaseUrl, "/api/v1/reports/lost-won-customers/status", cookieHeader)
  );

  server.registerTool(
    "reports_get_expansion_waterfall",
    {
      title: "Reports: Expansion Waterfall",
      description:
        "Fetch expansion waterfall insight data showing MRR movements (new, expansion, contraction, churn). " +
        "Use when the user asks about revenue growth composition or MRR waterfall analysis.",
      inputSchema: CookieInput.shape
    },
    async ({ cookieHeader }) => executeGet(apiBaseUrl, "/api/v1/reports/insights/expansion-waterfall", cookieHeader)
  );

  server.registerTool(
    "reports_get_ltv",
    {
      title: "Reports: LTV",
      description:
        "Fetch customer lifetime value (LTV) insight data. " +
        "Use when the user asks about customer LTV, average revenue per customer, or long-term value analysis.",
      inputSchema: CookieInput.shape
    },
    async ({ cookieHeader }) => executeGet(apiBaseUrl, "/api/v1/reports/insights/ltv", cookieHeader)
  );

  // ── Customer Losses ─────────────────────────────────────────────────

  server.registerTool(
    "customer_losses_list",
    {
      title: "Customer Losses: List",
      description:
        "List all customer loss entries. " +
        "Requires admin or editor role. " +
        "Use when analyzing overall customer churn or loss trends across the business.",
      inputSchema: CookieInput.shape
    },
    async ({ cookieHeader }) => executeGet(apiBaseUrl, "/api/v1/customer-losses", cookieHeader)
  );

  server.registerTool(
    "customer_losses_get_by_id",
    {
      title: "Customer Losses: Get By ID",
      description:
        "Fetch a single customer loss record by its ID. " +
        "Requires admin or editor role. " +
        "Input: lossId (numeric loss record ID).",
      inputSchema: LossIdInput.shape
    },
    async ({ lossId, cookieHeader }) => {
      const id = assertSafeSegment(lossId, "lossId");
      return executeGet(apiBaseUrl, `/api/v1/customer-losses/${id}`, cookieHeader);
    }
  );

  // ── Reports Embed (public/no-auth) ──────────────────────────────────

  server.registerTool(
    "reports_embed_get",
    {
      title: "Reports Embed: Get",
      description:
        "Fetch a public/embed report by slug. " +
        "These endpoints may not require authentication (VPN-gated). " +
        "Input: slug (report identifier), optional query params, optional useLegacyApiEmbedPath to use /api/embed/ instead of /api/v1/reports/embed/.",
      inputSchema: ReportsEmbedInput.shape
    },
    async ({ slug, query, cookieHeader, useLegacyApiEmbedPath }) => {
      const safeSlug = assertSafeSegment(slug, "slug");
      const basePath = useLegacyApiEmbedPath ? "/api/embed" : "/api/v1/reports/embed";
      const endpoint = withQuery(`${basePath}/${safeSlug}`, query);
      return executeGet(apiBaseUrl, endpoint, cookieHeader);
    }
  );
}
