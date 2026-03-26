import { getRequestAuthState } from "./requestContext.js";
import { callUpstreamApi, formatUpstreamError } from "./http.js";

/**
 * Build a single Cookie header value from Set-Cookie lines (name=value only).
 */
export function cookieHeaderFromSetCookie(setCookie: string[]): string {
  return setCookie.map((line) => line.split(";")[0].trim()).filter(Boolean).join("; ");
}

/**
 * Resolves the Cookie header for upstream PluMRR calls.
 * 1) If explicitCookie is non-empty, use it.
 * 2) Else if this HTTP request included X-Plumrr-Email / X-Plumrr-Password (LibreChat),
 *    perform one login per request and cache the cookie in AsyncLocalStorage (not persisted).
 * 3) Else throw.
 */
export async function resolveCookieHeader(
  apiBaseUrl: string,
  explicitCookie?: string
): Promise<string> {
  if (explicitCookie?.trim()) {
    return explicitCookie.trim();
  }

  const store = getRequestAuthState();
  if (store?.cachedCookieHeader) {
    return store.cachedCookieHeader;
  }

  const email = store?.email;
  const password = store?.password;
  if (!email || !password) {
    throw new Error(
      "Missing authentication: pass cookieHeader from a prior auth_login, " +
        "or configure LibreChat MCP to send credential headers on each request " +
        "(e.g. X-Plumrr-Email and X-Plumrr-Password matching PLUMRR_CREDENTIAL_HEADER_* env names)."
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

  const header = cookieHeaderFromSetCookie(result.setCookie);
  if (!header) {
    throw new Error("Login succeeded but no Set-Cookie headers were returned.");
  }

  if (store) {
    store.cachedCookieHeader = header;
  }

  return header;
}
