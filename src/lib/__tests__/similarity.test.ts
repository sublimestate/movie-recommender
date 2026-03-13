import { describe, it, expect } from "vitest";
import { cosineSimilarity } from "../similarity";

describe("cosineSimilarity", () => {
  it("returns 1 for identical vectors", () => {
    expect(cosineSimilarity([1, 2, 3], [1, 2, 3])).toBeCloseTo(1.0);
  });

  it("returns 0 for orthogonal vectors", () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0.0);
  });

  it("returns -1 for opposite vectors", () => {
    expect(cosineSimilarity([1, 0], [-1, 0])).toBeCloseTo(-1.0);
  });

  it("returns 0 for zero vectors", () => {
    expect(cosineSimilarity([0, 0], [1, 2])).toBe(0);
  });

  it("handles real-world sparse vectors", () => {
    const a = [1, 0, 1, 0, 0, 1];
    const b = [1, 0, 0, 0, 0, 1];
    // dot=2, |a|=sqrt(3), |b|=sqrt(2), cos=2/sqrt(6) ≈ 0.8165
    expect(cosineSimilarity(a, b)).toBeCloseTo(0.8165, 3);
  });
});
