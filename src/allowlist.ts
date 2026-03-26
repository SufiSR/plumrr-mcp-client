const EXACT_GET_PATHS = new Set<string>([
  "/api/v1/contracts/all",
  "/api/v1/contracts/current",
  "/api/v1/contracts",
  "/api/v1/customers",
  "/api/v1/reports/filter-options",
  "/api/v1/reports/customer-world-map",
  "/api/v1/reports/lorenz-curve/filter-options",
  "/api/v1/reports/lost-won-customers",
  "/api/v1/reports/lost-won-customers/status",
  "/api/v1/reports/insights/expansion-waterfall",
  "/api/v1/reports/insights/ltv",
  "/api/v1/customer-losses"
]);

const REGEX_GET_PATHS: RegExp[] = [
  /^\/api\/v1\/contracts\/[^/]+\/losses$/,
  /^\/api\/v1\/contracts\/[^/]+\/sanity-check$/,
  /^\/api\/v1\/contracts\/[^/]+\/order-items$/,
  /^\/api\/v1\/contracts\/[^/]+\/recurring-orders$/,
  /^\/api\/v1\/contracts\/[^/]+\/item-overrides$/,
  /^\/api\/v1\/contracts\/[^/]+\/orders\/[^/]+\/check-timeframes$/,
  /^\/api\/v1\/mrr\/customer\/[^/]+$/,
  /^\/api\/v1\/customers\/[^/]+$/,
  /^\/api\/v1\/customer-losses\/[^/]+$/,
  /^\/api\/v1\/reports\/embed\/.+$/,
  /^\/api\/embed\/.+$/
];

const AUTH_ENDPOINTS = new Set<string>([
  "/api/v1/auth/login",
  "/api/v1/auth/refresh",
  "/api/v1/auth/logout",
  "/api/v1/auth/me"
]);

export function isAllowedGetPath(path: string): boolean {
  if (EXACT_GET_PATHS.has(path)) {
    return true;
  }
  return REGEX_GET_PATHS.some((pattern) => pattern.test(path));
}

export function isAllowedAuthPath(path: string): boolean {
  return AUTH_ENDPOINTS.has(path);
}
