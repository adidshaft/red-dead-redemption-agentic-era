import { describe, expect, it } from "vitest";

import { issueAccessToken, readAddressFromToken } from "./auth.js";

describe("session token helpers", () => {
  it("round-trips a wallet address through the signed token", () => {
    const token = issueAccessToken("0xAbC123", "test-secret");
    expect(readAddressFromToken(token, "test-secret")).toBe("0xabc123");
  });

  it("rejects tokens with the wrong secret", () => {
    const token = issueAccessToken("0xAbC123", "test-secret");
    expect(readAddressFromToken(token, "other-secret")).toBeNull();
  });
});
