import { describe, expect, it } from "vitest";
import { cookieHeaderFromSetCookie } from "../src/resolveAuth.js";

describe("cookieHeaderFromSetCookie", () => {
  it("joins name=value segments from Set-Cookie lines", () => {
    const result = cookieHeaderFromSetCookie([
      "plumrr_access=abc; HttpOnly; Path=/",
      "plumrr_access_refresh=def; HttpOnly; Path=/"
    ]);
    expect(result).toBe("plumrr_access=abc; plumrr_access_refresh=def");
  });
});
