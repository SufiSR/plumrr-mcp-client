import { describe, expect, it } from "vitest";
import { isAllowedAuthPath, isAllowedGetPath } from "../src/allowlist.js";

describe("allowlist", () => {
  describe("auth endpoints", () => {
    it("allows all four auth endpoints", () => {
      expect(isAllowedAuthPath("/api/v1/auth/login")).toBe(true);
      expect(isAllowedAuthPath("/api/v1/auth/refresh")).toBe(true);
      expect(isAllowedAuthPath("/api/v1/auth/logout")).toBe(true);
      expect(isAllowedAuthPath("/api/v1/auth/me")).toBe(true);
    });

    it("rejects unknown auth paths", () => {
      expect(isAllowedAuthPath("/api/v1/auth/users")).toBe(false);
      expect(isAllowedAuthPath("/api/v1/auth/register")).toBe(false);
      expect(isAllowedAuthPath("/api/v1/auth/csrf-token")).toBe(false);
    });
  });

  describe("exact GET paths", () => {
    const exactPaths = [
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
    ];

    for (const path of exactPaths) {
      it(`allows ${path}`, () => {
        expect(isAllowedGetPath(path)).toBe(true);
      });
    }
  });

  describe("parameterized GET paths", () => {
    it("allows contracts sub-resources with customer id", () => {
      expect(isAllowedGetPath("/api/v1/contracts/42/losses")).toBe(true);
      expect(isAllowedGetPath("/api/v1/contracts/42/sanity-check")).toBe(true);
      expect(isAllowedGetPath("/api/v1/contracts/42/order-items")).toBe(true);
      expect(isAllowedGetPath("/api/v1/contracts/42/recurring-orders")).toBe(true);
      expect(isAllowedGetPath("/api/v1/contracts/42/item-overrides")).toBe(true);
    });

    it("allows order timeframe check with customer and order id", () => {
      expect(isAllowedGetPath("/api/v1/contracts/42/orders/99/check-timeframes")).toBe(true);
    });

    it("allows mrr customer path", () => {
      expect(isAllowedGetPath("/api/v1/mrr/customer/42")).toBe(true);
    });

    it("allows customer by id", () => {
      expect(isAllowedGetPath("/api/v1/customers/123")).toBe(true);
    });

    it("allows customer loss by id", () => {
      expect(isAllowedGetPath("/api/v1/customer-losses/7")).toBe(true);
    });

    it("allows embed report paths", () => {
      expect(isAllowedGetPath("/api/v1/reports/embed/customer-world-map")).toBe(true);
      expect(isAllowedGetPath("/api/embed/some-report")).toBe(true);
    });
  });

  describe("blocked paths", () => {
    it("rejects unknown report sub-paths", () => {
      expect(isAllowedGetPath("/api/v1/reports/unknown")).toBe(false);
    });

    it("rejects mutation endpoints", () => {
      expect(isAllowedGetPath("/api/v1/contracts/create")).toBe(false);
    });

    it("rejects auth paths as GET paths", () => {
      expect(isAllowedGetPath("/api/v1/auth/login")).toBe(false);
      expect(isAllowedGetPath("/api/v1/auth/me")).toBe(false);
    });

    it("rejects paths with traversal segments", () => {
      expect(isAllowedGetPath("/api/v1/customers/../admin")).toBe(false);
    });
  });
});
