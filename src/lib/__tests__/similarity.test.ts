import { describe, it, expect } from "vitest";
import {
  cosineSimilarity,
  buildFeatureVector,
  clusterMovies,
} from "../similarity";
import type { DimensionMappings, MovieAttributes } from "../similarity";

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

describe("buildFeatureVector", () => {
  const mappings: DimensionMappings = {
    genreIds: [28, 18, 35],           // Action, Drama, Comedy
    keywordIds: [100, 200, 300],
    castIds: [10, 20],
    directorIds: [30],
    decadeMin: 1920,
    decadeMax: 2030,
  };

  it("sets genre bits correctly", () => {
    const attrs: MovieAttributes = {
      genres: [28, 35],  // Action, Comedy
      keywords: [],
      castIds: [],
      directorIds: [],
      decade: 2000,
      rating: 7.0,
    };
    const vec = buildFeatureVector(attrs, mappings);
    // genres: [1, 0, 1], keywords: [0,0,0], cast: [0,0], director: [0], decade, rating
    expect(vec[0]).toBe(1); // Action
    expect(vec[1]).toBe(0); // Drama
    expect(vec[2]).toBe(1); // Comedy
  });

  it("sets keyword, cast, director bits correctly", () => {
    const attrs: MovieAttributes = {
      genres: [],
      keywords: [200],
      castIds: [20],
      directorIds: [30],
      decade: 2000,
      rating: 7.0,
    };
    const vec = buildFeatureVector(attrs, mappings);
    // genres: [0,0,0], keywords: [0,1,0], cast: [0,1], director: [1], decade, rating
    expect(vec[3]).toBe(0);  // keyword 100
    expect(vec[4]).toBe(1);  // keyword 200
    expect(vec[5]).toBe(0);  // keyword 300
    expect(vec[6]).toBe(0);  // cast 10
    expect(vec[7]).toBe(1);  // cast 20
    expect(vec[8]).toBe(1);  // director 30
  });

  it("normalizes decade and rating", () => {
    const attrs: MovieAttributes = {
      genres: [],
      keywords: [],
      castIds: [],
      directorIds: [],
      decade: 1975,
      rating: 5.0,
    };
    const vec = buildFeatureVector(attrs, mappings);
    const decadeIdx = 3 + 3 + 2 + 1; // after genres(3)+keywords(3)+cast(2)+director(1) = idx 9
    const ratingIdx = decadeIdx + 1;
    // decade: (1975 - 1920) / (2030 - 1920) = 55/110 = 0.5
    expect(vec[decadeIdx]).toBeCloseTo(0.5);
    // rating: 5.0 / 10.0 = 0.5
    expect(vec[ratingIdx]).toBeCloseTo(0.5);
  });

  it("clamps decade outside range", () => {
    const attrs: MovieAttributes = {
      genres: [],
      keywords: [],
      castIds: [],
      directorIds: [],
      decade: 1900,
      rating: 0,
    };
    const vec = buildFeatureVector(attrs, mappings);
    const decadeIdx = 3 + 3 + 2 + 1;
    expect(vec[decadeIdx]).toBe(0);
  });
});

describe("clusterMovies", () => {
  it("puts identical vectors in the same cluster", () => {
    const vectors = new Map<number, number[]>();
    vectors.set(1, [1, 0, 1, 0]);
    vectors.set(2, [1, 0, 1, 0]);
    vectors.set(3, [0, 1, 0, 1]);
    const clusters = clusterMovies(vectors, 0.6);
    expect(clusters.length).toBe(2);
    const clusterWith1 = clusters.find((c) => c.memberIds.includes(1))!;
    expect(clusterWith1.memberIds).toContain(2);
    expect(clusterWith1.memberIds).not.toContain(3);
  });

  it("keeps dissimilar vectors in separate clusters", () => {
    const vectors = new Map<number, number[]>();
    vectors.set(1, [1, 0, 0, 0]);
    vectors.set(2, [0, 1, 0, 0]);
    vectors.set(3, [0, 0, 1, 0]);
    const clusters = clusterMovies(vectors, 0.6);
    expect(clusters.length).toBe(3);
  });

  it("returns one cluster per movie when threshold is very high", () => {
    const vectors = new Map<number, number[]>();
    vectors.set(1, [1, 0.5, 0]);
    vectors.set(2, [0.9, 0.6, 0]);
    const clusters = clusterMovies(vectors, 0.999);
    expect(clusters.length).toBe(2);
  });

  it("handles single movie", () => {
    const vectors = new Map<number, number[]>();
    vectors.set(1, [1, 0, 1]);
    const clusters = clusterMovies(vectors, 0.6);
    expect(clusters.length).toBe(1);
    expect(clusters[0].memberIds).toEqual([1]);
  });

  it("handles empty input", () => {
    const vectors = new Map<number, number[]>();
    const clusters = clusterMovies(vectors, 0.6);
    expect(clusters.length).toBe(0);
  });

  it("computes cluster centroid correctly", () => {
    const vectors = new Map<number, number[]>();
    vectors.set(1, [1, 0]);
    vectors.set(2, [0, 1]);
    const clusters = clusterMovies(vectors, -1);
    expect(clusters.length).toBe(1);
    expect(clusters[0].centroid[0]).toBeCloseTo(0.5);
    expect(clusters[0].centroid[1]).toBeCloseTo(0.5);
  });
});
