import { describe, expect, it, beforeEach } from "vitest";
import {
  buildSkillNamesOnlyPrompt,
  classifyPromptComplexity,
  classifyProviderError,
  clearRoutingCache,
  extractJsonBlock,
  getRoutingCacheStats,
  isRateLimited,
  isRetryable,
  isValidRule,
  tryRuleBasedRoute,
  type SkillIndexEntry,
  type VikingRule,
} from "./viking-router.js";

describe("viking-router", () => {
  beforeEach(() => {
    clearRoutingCache();
  });

  describe("extractJsonBlock", () => {
    it("extracts simple JSON object", () => {
      const result = extractJsonBlock('Here is the result: {"packs":["web"],"files":[]} done');
      expect(result).toBe('{"packs":["web"],"files":[]}');
    });

    it("extracts nested JSON object", () => {
      const result = extractJsonBlock(
        'Response: {"packs":["web"],"files":[{"name":"test.ts"}]} end',
      );
      expect(result).toBe('{"packs":["web"],"files":[{"name":"test.ts"}]}');
    });

    it("returns null when no JSON found", () => {
      expect(extractJsonBlock("no json here")).toBeNull();
    });

    it("handles JSON with braces inside strings", () => {
      const result = extractJsonBlock('{"key":"value with {braces}"}');
      expect(result).toBe('{"key":"value with {braces}"}');
    });

    it("handles JSON with escaped quotes", () => {
      const result = extractJsonBlock('{"key":"value with \\"quotes\\""}');
      expect(result).toBe('{"key":"value with \\"quotes\\""}');
    });

    it("handles deeply nested JSON", () => {
      const result = extractJsonBlock('{"a":{"b":{"c":1}}}');
      expect(result).toBe('{"a":{"b":{"c":1}}}');
    });

    it("returns first complete JSON block when multiple exist", () => {
      const result = extractJsonBlock('{"a":1} and {"b":2}');
      expect(result).toBe('{"a":1}');
    });

    it("returns null for unclosed JSON", () => {
      expect(extractJsonBlock('{"key":"value"')).toBeNull();
    });
  });

  describe("isRateLimited", () => {
    it("detects 429 in Error message", () => {
      expect(isRateLimited(new Error("429 Too Many Requests"))).toBe(true);
    });

    it("detects rate limit in error message (case insensitive)", () => {
      expect(isRateLimited(new Error("rate limit exceeded"))).toBe(true);
      expect(isRateLimited(new Error("Rate limited"))).toBe(true);
    });

    it("returns false for non-rate-limit errors", () => {
      expect(isRateLimited(new Error("network error"))).toBe(false);
      expect(isRateLimited(null)).toBe(false);
      expect(isRateLimited(undefined)).toBe(false);
    });

    it("returns false for plain objects (not Error instances)", () => {
      expect(isRateLimited({ status: 429, message: "Too Many Requests" })).toBe(false);
    });
  });

  describe("isRetryable", () => {
    it("detects 429 as retryable", () => {
      expect(isRetryable(new Error("429 rate limited"))).toBe(true);
    });

    it("detects 503 as retryable", () => {
      expect(isRetryable(new Error("503 service unavailable"))).toBe(true);
    });

    it("detects 502 as retryable", () => {
      expect(isRetryable(new Error("502 bad gateway"))).toBe(true);
    });

    it("detects ETIMEDOUT as retryable", () => {
      expect(isRetryable(new Error("ETIMEDOUT connection timed out"))).toBe(true);
    });

    it("detects ECONNRESET as retryable", () => {
      expect(isRetryable(new Error("ECONNRESET connection reset"))).toBe(true);
    });

    it("detects ENOTFOUND as retryable", () => {
      expect(isRetryable(new Error("ENOTFOUND dns lookup failed"))).toBe(true);
    });

    it("returns false for non-retryable errors", () => {
      expect(isRetryable(new Error("400 bad request"))).toBe(false);
      expect(isRetryable(new Error("401 unauthorized"))).toBe(false);
    });

    it("returns false for non-Error objects", () => {
      expect(isRetryable(null)).toBe(false);
      expect(isRetryable(undefined)).toBe(false);
      expect(isRetryable("string error")).toBe(false);
    });
  });

  describe("isValidRule", () => {
    it("validates a correct rule", () => {
      expect(
        isValidRule({
          when: { promptMaxLength: 50, noFileContext: true },
          apply: { packs: ["web"], promptMode: "L0" },
        }),
      ).toBe(true);
    });

    it("rejects null", () => {
      expect(isValidRule(null)).toBe(false);
    });

    it("rejects undefined", () => {
      expect(isValidRule(undefined)).toBe(false);
    });

    it("rejects non-object", () => {
      expect(isValidRule("string")).toBe(false);
      expect(isValidRule(42)).toBe(false);
    });

    it("rejects missing when", () => {
      expect(isValidRule({ apply: { packs: [], promptMode: "L0" } })).toBe(false);
    });

    it("rejects missing apply", () => {
      expect(isValidRule({ when: { promptMaxLength: 50 } })).toBe(false);
    });

    it("rejects non-object when", () => {
      expect(isValidRule({ when: "invalid", apply: { packs: [], promptMode: "L0" } })).toBe(false);
    });

    it("rejects non-array packs", () => {
      expect(
        isValidRule({ when: { promptMaxLength: 50 }, apply: { packs: "web", promptMode: "L0" } }),
      ).toBe(false);
    });

    it("rejects non-string promptMode", () => {
      expect(
        isValidRule({ when: { promptMaxLength: 50 }, apply: { packs: [], promptMode: 42 } }),
      ).toBe(false);
    });

    it("accepts rule with empty packs", () => {
      expect(
        isValidRule({ when: { noFileContext: true }, apply: { packs: [], promptMode: "L0" } }),
      ).toBe(true);
    });
  });

  describe("classifyProviderError", () => {
    it("classifies rate limit errors from Error with 429", () => {
      const result = classifyProviderError(new Error("429 rate limit"));
      expect(result.type).toBe("rate_limit");
      expect(result.retryable).toBe(true);
    });

    it("classifies auth errors from Error with 401", () => {
      const result = classifyProviderError(new Error("401 unauthorized"));
      expect(result.type).toBe("auth");
      expect(result.retryable).toBe(false);
    });

    it("classifies transient errors from Error with 503", () => {
      const result = classifyProviderError(new Error("503 timeout"));
      expect(result.type).toBe("transient");
      expect(result.retryable).toBe(true);
    });

    it("classifies unknown errors for plain objects", () => {
      const result = classifyProviderError({ status: 429 });
      expect(result.type).toBe("unknown");
      expect(result.retryable).toBe(false);
    });

    it("classifies unknown errors for generic Error", () => {
      const result = classifyProviderError(new Error("something"));
      expect(result.type).toBe("unknown");
      expect(result.retryable).toBe(false);
    });
  });

  describe("classifyPromptComplexity", () => {
    it("classifies short simple prompts as simple complexity", () => {
      const result = classifyPromptComplexity("hello");
      expect(result.complexity).toBe("simple");
    });

    it("classifies long detailed prompts as moderate or complex", () => {
      const longPrompt = "Please analyze the following codebase in detail ".repeat(50);
      const result = classifyPromptComplexity(longPrompt);
      expect(["moderate", "complex"]).toContain(result.complexity);
    });

    it("returns maxTokens based on complexity", () => {
      const simple = classifyPromptComplexity("hi");
      const complex = classifyPromptComplexity(
        "Analyze this complex multi-step problem ".repeat(30),
      );
      expect(simple.maxTokens).toBeLessThanOrEqual(complex.maxTokens);
    });
  });

  describe("buildSkillNamesOnlyPrompt", () => {
    it("returns empty string for empty skills", () => {
      expect(buildSkillNamesOnlyPrompt([])).toBe("");
    });

    it("formats skill names", () => {
      const skills: SkillIndexEntry[] = [
        { name: "web-search", description: "Search the web" },
        { name: "code-exec", description: "Execute code" },
      ];
      const result = buildSkillNamesOnlyPrompt(skills);
      expect(result).toContain("web-search");
      expect(result).toContain("code-exec");
    });
  });

  describe("cache management", () => {
    it("starts with empty cache", () => {
      const stats = getRoutingCacheStats();
      expect(stats.size).toBe(0);
      expect(stats.hitRate).toBe(0);
    });

    it("clears cache", () => {
      clearRoutingCache();
      const stats = getRoutingCacheStats();
      expect(stats.size).toBe(0);
    });
  });

  describe("tryRuleBasedRoute", () => {
    it("matches default rule for short prompt without file context", () => {
      const result = tryRuleBasedRoute({
        fileNames: [],
        promptLength: 12,
        hasFileContext: false,
      });
      expect(result).not.toBeNull();
      expect(result!.promptLayer).toBe("L0");
      expect(result!.tools).toBeDefined();
    });

    it("returns null when no rules match (long prompt with file context)", () => {
      const result = tryRuleBasedRoute({
        fileNames: ["test.ts"],
        promptLength: 500,
        hasFileContext: true,
      });
      expect(result).toBeNull();
    });

    it("matches rule with short prompt and no file context", () => {
      const result = tryRuleBasedRoute({
        fileNames: [],
        promptLength: 2,
        hasFileContext: false,
      });
      expect(result).not.toBeNull();
      expect(result!.promptLayer).toBeDefined();
      expect(result!.tools).toBeDefined();
    });
  });

  describe("VikingRule interface", () => {
    it("uses apply field (not then)", () => {
      const rule: VikingRule = {
        when: { promptMaxLength: 50, noFileContext: true },
        apply: { packs: [], promptMode: "L0" },
      };
      expect(rule.apply.packs).toEqual([]);
      expect(rule.apply.promptMode).toBe("L0");
    });
  });
});
