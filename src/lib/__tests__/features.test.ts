import { describe, it, expect } from "vitest";
import { buildDimensionMappings } from "../features";
import type { MovieAttributes } from "../similarity";

describe("buildDimensionMappings", () => {
  it("selects top N most frequent keywords", () => {
    const features: MovieAttributes[] = [
      { genres: [28], keywords: [100, 200], castIds: [1], directorIds: [10], decade: 2000, rating: 7 },
      { genres: [28], keywords: [100, 300], castIds: [1], directorIds: [10], decade: 2000, rating: 7 },
      { genres: [18], keywords: [100, 400], castIds: [2], directorIds: [10], decade: 2000, rating: 7 },
    ];
    const mappings = buildDimensionMappings(features);
    expect(mappings.keywordIds[0]).toBe(100);
    expect(mappings.keywordIds.length).toBeLessThanOrEqual(50);
  });

  it("selects top N most frequent cast", () => {
    const features: MovieAttributes[] = [
      { genres: [], keywords: [], castIds: [1, 2], directorIds: [], decade: 2000, rating: 7 },
      { genres: [], keywords: [], castIds: [1, 3], directorIds: [], decade: 2000, rating: 7 },
    ];
    const mappings = buildDimensionMappings(features);
    expect(mappings.castIds[0]).toBe(1);
    expect(mappings.castIds.length).toBeLessThanOrEqual(25);
  });

  it("includes all GENRE_MAP ids", () => {
    const features: MovieAttributes[] = [];
    const mappings = buildDimensionMappings(features);
    expect(mappings.genreIds.length).toBe(19);
  });

  it("sets decade range correctly", () => {
    const features: MovieAttributes[] = [];
    const mappings = buildDimensionMappings(features);
    expect(mappings.decadeMin).toBe(1920);
    expect(mappings.decadeMax).toBe(2030);
  });
});
