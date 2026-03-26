const DEFAULT_TIMEOUT_MS = 30_000;

export type RequestOptions = {
  method: "GET" | "POST";
  path: string;
  body?: unknown;
  cookieHeader?: string;
  timeoutMs?: number;
};

export type UpstreamResult = {
  status: number;
  ok: boolean;
  headers: Record<string, string>;
  setCookie: string[];
  json: unknown;
  text: string;
};

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
}

function collectSetCookies(response: Response): string[] {
  const nativeHeaders = response.headers as Headers & { getSetCookie?: () => string[] };
  if (typeof nativeHeaders.getSetCookie === "function") {
    return nativeHeaders.getSetCookie();
  }

  const raw = response.headers.get("set-cookie");
  return raw ? [raw] : [];
}

export async function callUpstreamApi(baseUrl: string, options: RequestOptions): Promise<UpstreamResult> {
  const url = `${normalizeBaseUrl(baseUrl)}${options.path}`;
  const headers: Record<string, string> = {
    "content-type": "application/json"
  };

  if (options.cookieHeader) {
    headers.cookie = options.cookieHeader;
  }

  const controller = new AbortController();
  const timeout = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      method: options.method,
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: controller.signal,
      redirect: "manual"
    });

    const text = await response.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }

    const headerRecord: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      headerRecord[key] = value;
    });

    return {
      status: response.status,
      ok: response.ok,
      headers: headerRecord,
      setCookie: collectSetCookies(response),
      json,
      text
    };
  } finally {
    clearTimeout(timer);
  }
}

export function formatUpstreamError(result: UpstreamResult): string {
  if (typeof result.json === "object" && result.json && "detail" in (result.json as Record<string, unknown>)) {
    const detail = (result.json as Record<string, unknown>).detail;
    return `Upstream error ${result.status}: ${String(detail)}`;
  }
  return `Upstream error ${result.status}: ${result.text || "Unknown error"}`;
}
