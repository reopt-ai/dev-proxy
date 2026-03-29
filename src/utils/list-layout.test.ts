import { describe, expect, it } from "vitest";
import {
  getListDimensions,
  buildListHeaderTokens,
  LIST_FIXED_WIDTH,
} from "./list-layout.js";

describe("getListDimensions", () => {
  it("calculates full-width layout", () => {
    const dims = getListDimensions({ rows: 40, cols: 120 }, false);
    expect(dims.available).toBe(120);
    expect(dims.innerWidth).toBe(120 - 2 - 2); // cols - border - padding
    expect(dims.pathW).toBe(dims.innerWidth - LIST_FIXED_WIDTH);
    expect(dims.visibleRows).toBe(40 - 3 - 2); // rows - reserved - border
  });

  it("calculates half-width layout", () => {
    const dims = getListDimensions({ rows: 40, cols: 120 }, true);
    expect(dims.available).toBe(60); // floor(120/2)
  });

  it("enforces minimum inner width of 16", () => {
    const dims = getListDimensions({ rows: 10, cols: 10 }, false);
    expect(dims.innerWidth).toBeGreaterThanOrEqual(16);
  });

  it("enforces minimum visible rows of 1", () => {
    const dims = getListDimensions({ rows: 3, cols: 80 }, false);
    expect(dims.visibleRows).toBeGreaterThanOrEqual(1);
  });

  it("enforces minimum path width of 16", () => {
    const dims = getListDimensions({ rows: 40, cols: 20 }, false);
    expect(dims.pathW).toBeGreaterThanOrEqual(16);
  });
});

describe("buildListHeaderTokens", () => {
  it("always includes REQUESTS and FOLLOW in left", () => {
    const result = buildListHeaderTokens({
      available: 40,
      count: 10,
      followMode: true,
      errorsOnly: false,
      hideNextStatic: true,
      searchQuery: "",
    });
    expect(result.left).toHaveLength(2);
    expect(result.left[0]?.text).toBe("REQUESTS");
    expect(result.left[1]?.text).toBe("FOLLOW");
    expect(result.left[1]?.active).toBe(true);
  });

  it("shows meta when available >= 56", () => {
    const result = buildListHeaderTokens({
      available: 56,
      count: 42,
      followMode: false,
      errorsOnly: false,
      hideNextStatic: true,
      searchQuery: "",
    });
    expect(result.showMeta).toBe(true);
    expect(result.right.find((t) => t.kind === "meta")?.text).toBe("42 VISIBLE");
  });

  it("hides meta when available < 56", () => {
    const result = buildListHeaderTokens({
      available: 55,
      count: 10,
      followMode: false,
      errorsOnly: false,
      hideNextStatic: true,
      searchQuery: "",
    });
    expect(result.showMeta).toBe(false);
  });

  it("shows filters when available >= 64", () => {
    const result = buildListHeaderTokens({
      available: 64,
      count: 10,
      followMode: false,
      errorsOnly: true,
      hideNextStatic: false,
      searchQuery: "api",
    });
    expect(result.showFilters).toBe(true);
    expect(result.right.find((t) => t.kind === "err")?.active).toBe(true);
    expect(result.right.find((t) => t.kind === "quiet")?.active).toBe(false);
    expect(result.right.find((t) => t.kind === "query")?.text).toBe("/api");
  });

  it("hides filters when available < 64", () => {
    const result = buildListHeaderTokens({
      available: 63,
      count: 10,
      followMode: false,
      errorsOnly: true,
      hideNextStatic: true,
      searchQuery: "test",
    });
    expect(result.showFilters).toBe(false);
    expect(result.right.find((t) => t.kind === "err")).toBeUndefined();
  });

  it("truncates long search queries", () => {
    const result = buildListHeaderTokens({
      available: 64,
      count: 10,
      followMode: false,
      errorsOnly: false,
      hideNextStatic: true,
      searchQuery: "a-very-long-search-query-that-exceeds-limit",
    });
    const queryToken = result.right.find((t) => t.kind === "query");
    expect(queryToken).toBeDefined();
    // 18 chars max for filters view + "/" prefix
    expect(queryToken?.text.length).toBeLessThanOrEqual(19);
  });
});
