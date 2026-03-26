import { describe, expect, it } from "vitest";
import { rankCustomersByQuery, scoreNameMatch } from "../src/customerMatch.js";

describe("scoreNameMatch", () => {
  it("scores exact match highly", () => {
    expect(scoreNameMatch("Siemens AG", "Siemens AG")).toBeGreaterThan(0.99);
  });

  it("handles minor typos", () => {
    const s = scoreNameMatch("Siemens", "Simens");
    expect(s).toBeGreaterThan(0.75);
  });

  it("matches substring in longer company name", () => {
    expect(scoreNameMatch("Siemens", "Siemens Deutschland GmbH")).toBeGreaterThan(0.85);
  });
});

describe("rankCustomersByQuery", () => {
  it("orders by relevance", () => {
    const rows = [
      { id: 1, customer_name: "Other Corp" },
      { id: 2, customer_name: "Siemens AG" },
      { id: 3, customer_name: "ACME" }
    ];
    const ranked = rankCustomersByQuery("Siemens", rows);
    expect(ranked[0]?.id).toBe(2);
    expect(ranked[0]?.matchScore).toBeGreaterThan(ranked[1]?.matchScore ?? 0);
  });
});
