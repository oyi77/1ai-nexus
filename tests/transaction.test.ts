import { describe, expect, it } from "vitest";

describe("transaction processor", () => {
  it("whale classification", async () => {
    const classify = (usd: number) => {
      if (usd >= 5_000_000) return "mega";
      if (usd >= 500_000) return "high";
      if (usd >= 50_000) return "mid";
      return "low";
    };
    expect(classify(1_000_000_000)).toBe("mega");
    expect(classify(600_000)).toBe("high");
    expect(classify(100_000)).toBe("mid");
    expect(classify(10_000)).toBe("low");
  });
});
