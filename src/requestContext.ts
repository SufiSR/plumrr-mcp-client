import { AsyncLocalStorage } from "node:async_hooks";
import type { Request } from "express";

export type RequestAuthState = {
  email?: string;
  password?: string;
  /** Populated after first successful login in this request (not persisted across requests). */
  cachedCookieHeader?: string;
};

const storage = new AsyncLocalStorage<RequestAuthState>();

export function getRequestAuthState(): RequestAuthState | undefined {
  return storage.getStore();
}

function readHeader(req: Request, canonicalName: string): string | undefined {
  const key = canonicalName.toLowerCase();
  const raw = req.headers[key];
  if (typeof raw === "string" && raw.trim()) {
    return raw.trim();
  }
  if (Array.isArray(raw) && raw[0]?.trim()) {
    return raw[0].trim();
  }
  return undefined;
}

export function runWithRequestContext<T>(
  req: Request,
  headerEmailName: string,
  headerPasswordName: string,
  fn: () => T
): T {
  const email = readHeader(req, headerEmailName);
  const password = readHeader(req, headerPasswordName);
  const state: RequestAuthState = {};
  if (email) {
    state.email = email;
  }
  if (password) {
    state.password = password;
  }
  return storage.run(state, fn);
}
