import { describe, expect, it } from "vitest";

const SAFE_PATH_SEGMENT = /^[a-zA-Z0-9_\-]+$/;

function assertSafeSegment(value: string | number, label: string): string {
  const str = String(value);
  if (!SAFE_PATH_SEGMENT.test(str)) {
    throw new Error(`Invalid ${label}: must be alphanumeric, dash, or underscore.`);
  }
  return str;
}

function stripQueryString(path: string): string {
  const idx = path.indexOf("?");
  return idx === -1 ? path : path.substring(0, idx);
}

function withQuery(path: string, query?: Record<string, string | number | boolean>): string {
  if (!query || Object.keys(query).length === 0) {
    return path;
  }
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    params.set(key, String(value));
  }
  return `${path}?${params.toString()}`;
}

describe("assertSafeSegment", () => {
  it("allows numeric ids", () => {
    expect(assertSafeSegment(42, "id")).toBe("42");
    expect(assertSafeSegment("123", "id")).toBe("123");
  });

  it("allows alphanumeric with dashes and underscores", () => {
    expect(assertSafeSegment("abc-123_XYZ", "slug")).toBe("abc-123_XYZ");
  });

  it("rejects path traversal", () => {
    expect(() => assertSafeSegment("../../admin", "id")).toThrow("Invalid id");
  });

  it("rejects slashes", () => {
    expect(() => assertSafeSegment("foo/bar", "id")).toThrow("Invalid id");
  });

  it("rejects empty strings", () => {
    expect(() => assertSafeSegment("", "id")).toThrow("Invalid id");
  });

  it("rejects spaces", () => {
    expect(() => assertSafeSegment("foo bar", "id")).toThrow("Invalid id");
  });

  it("rejects encoded characters", () => {
    expect(() => assertSafeSegment("foo%2Fbar", "id")).toThrow("Invalid id");
  });
});

describe("stripQueryString", () => {
  it("returns path unchanged when no query string", () => {
    expect(stripQueryString("/api/v1/customers")).toBe("/api/v1/customers");
  });

  it("strips query string", () => {
    expect(stripQueryString("/api/v1/contracts/current?customer_id=1")).toBe("/api/v1/contracts/current");
  });

  it("handles multiple query params", () => {
    expect(stripQueryString("/api/v1/test?a=1&b=2")).toBe("/api/v1/test");
  });
});

describe("withQuery", () => {
  it("returns path unchanged when no query", () => {
    expect(withQuery("/api/v1/test")).toBe("/api/v1/test");
    expect(withQuery("/api/v1/test", {})).toBe("/api/v1/test");
  });

  it("appends query params", () => {
    const result = withQuery("/api/v1/test", { a: "1", b: 2, c: true });
    expect(result).toContain("/api/v1/test?");
    expect(result).toContain("a=1");
    expect(result).toContain("b=2");
    expect(result).toContain("c=true");
  });
});
