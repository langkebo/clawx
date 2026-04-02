import { describe, expect, it } from "vitest";
import {
  buildSearXNGContext,
  isSearXNGConfigured,
  SEARXNG_DEFAULT_CONFIG,
  type SearXNGResult,
} from "./searxng-search.js";

describe("searxng-search", () => {
  describe("buildSearXNGContext", () => {
    it("returns no results message for empty array", () => {
      expect(buildSearXNGContext([])).toBe("No search results found.");
    });

    it("formats single result correctly", () => {
      const results: SearXNGResult[] = [
        {
          title: "Test Result",
          url: "https://example.com",
          content: "Test content",
          engine: "google",
        },
      ];

      const context = buildSearXNGContext(results);
      expect(context).toContain("Web search results:");
      expect(context).toContain("[1] Test Result");
      expect(context).toContain("https://example.com");
      expect(context).toContain("Test content");
      expect(context).toContain("Source: google");
    });

    it("limits results to maxResults", () => {
      const results: SearXNGResult[] = Array.from({ length: 10 }, (_, i) => ({
        title: `Result ${i + 1}`,
        url: `https://example.com/${i + 1}`,
        content: `Content ${i + 1}`,
      }));

      const context = buildSearXNGContext(results, 3);
      expect(context).toContain("[1] Result 1");
      expect(context).toContain("[3] Result 3");
      expect(context).not.toContain("[4] Result 4");
    });

    it("truncates long content", () => {
      const longContent = "A".repeat(300);
      const results: SearXNGResult[] = [
        {
          title: "Long Content",
          url: "https://example.com",
          content: longContent,
        },
      ];

      const context = buildSearXNGContext(results);
      expect(context).toContain("...");
      expect(context).not.toContain("A".repeat(250));
    });
  });

  describe("isSearXNGConfigured", () => {
    it("returns false for null config", () => {
      expect(isSearXNGConfigured(null)).toBe(false);
    });

    it("returns false for undefined config", () => {
      expect(isSearXNGConfigured(undefined)).toBe(false);
    });

    it("returns false for empty host", () => {
      expect(isSearXNGConfigured({ host: "" })).toBe(false);
    });

    it("returns true for valid config", () => {
      expect(isSearXNGConfigured({ host: "http://localhost:8080" })).toBe(true);
    });
  });

  describe("SEARXNG_DEFAULT_CONFIG", () => {
    it("has expected default values", () => {
      expect(SEARXNG_DEFAULT_CONFIG.timeout).toBe(30_000);
      expect(SEARXNG_DEFAULT_CONFIG.engines).toContain("google");
      expect(SEARXNG_DEFAULT_CONFIG.language).toBe("en");
      expect(SEARXNG_DEFAULT_CONFIG.safeSearch).toBe(1);
    });
  });
});
