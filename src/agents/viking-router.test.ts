import { describe, expect, it, beforeEach } from "vitest";
import {
  buildSkillNamesOnlyPrompt,
  classifyPromptComplexity,
  classifyProviderError,
  clearRoutingCache,
  extractJsonBlock,
  getRoutingCacheStats,
  getVikingFullStats,
  getVikingOptimizations,
  getVikingRouteTag,
  incrementRouteStats,
  invalidateCacheForTool,
  isRateLimited,
  isRetryable,
  isValidRule,
  tryRuleBasedRoute,
  vikingRouteWithFeedback,
  type SkillIndexEntry,
  type VikingRule,
  type VikingRouteFeedback,
  type VikingRouteResult,
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

    it("returns preferredModel and preferredProvider for simple prompts", () => {
      const result = classifyPromptComplexity("hi");
      expect(result.preferredModel).toBeDefined();
      expect(result.preferredProvider).toBeDefined();
    });

    it("returns preferredModel and preferredProvider for moderate prompts with keywords", () => {
      const result = classifyPromptComplexity("请编辑这个文件");
      expect(result.complexity).toBe("moderate");
      expect(result.preferredModel).toBeDefined();
      expect(result.preferredProvider).toBeDefined();
    });

    it("returns preferredModel and preferredProvider for moderate prompts without keywords", () => {
      const result = classifyPromptComplexity(
        "This is a moderately long prompt that needs some analysis",
      );
      expect(result.complexity).toBe("moderate");
      expect(result.preferredModel).toBeDefined();
      expect(result.preferredProvider).toBeDefined();
    });

    it("returns preferredModel and preferredProvider for complex prompts", () => {
      const result = classifyPromptComplexity(
        "Design and implement a distributed system with multiple microservices ".repeat(20),
      );
      if (result.complexity === "complex") {
        expect(result.preferredModel).toBeDefined();
        expect(result.preferredProvider).toBeDefined();
      }
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

  describe("isValidRule", () => {
    it("rejects rule with invalid promptMode", () => {
      expect(
        isValidRule({
          when: { promptMaxLength: 50 },
          apply: { packs: ["web"], promptMode: "L99" },
        }),
      ).toBe(false);
    });

    it("accepts rule with valid promptMode L0", () => {
      expect(
        isValidRule({
          when: { promptMaxLength: 50 },
          apply: { packs: [], promptMode: "L0" },
        }),
      ).toBe(true);
    });

    it("accepts rule with valid promptMode full", () => {
      expect(
        isValidRule({
          when: { promptMaxLength: 50 },
          apply: { packs: [], promptMode: "full" },
        }),
      ).toBe(true);
    });

    it("accepts rule with valid promptMode none", () => {
      expect(
        isValidRule({
          when: { promptMaxLength: 50 },
          apply: { packs: [], promptMode: "none" },
        }),
      ).toBe(true);
    });

    it("accepts rule with valid promptMode minimal", () => {
      expect(
        isValidRule({
          when: { promptMaxLength: 50 },
          apply: { packs: [], promptMode: "minimal" },
        }),
      ).toBe(true);
    });

    it("rejects rule without apply", () => {
      expect(isValidRule({ when: { promptMaxLength: 50 } })).toBe(false);
    });

    it("rejects rule without when", () => {
      expect(isValidRule({ apply: { packs: [], promptMode: "L0" } })).toBe(false);
    });
  });

  describe("classifyProviderError extended", () => {
    it("classifies 502 as transient", () => {
      const result = classifyProviderError(new Error("502 bad gateway"));
      expect(result.type).toBe("transient");
      expect(result.retryable).toBe(true);
    });

    it("classifies billing errors", () => {
      const result = classifyProviderError(new Error("billing quota exceeded"));
      expect(result.type).toBe("billing");
      expect(result.retryable).toBe(false);
    });

    it("classifies format errors from 422", () => {
      const result = classifyProviderError(new Error("422 invalid request"));
      expect(result.type).toBe("format");
      expect(result.retryable).toBe(false);
    });

    it("classifies auth errors from invalid api key", () => {
      const result = classifyProviderError(new Error("invalid api key provided"));
      expect(result.type).toBe("auth");
      expect(result.retryable).toBe(false);
    });
  });

  describe("incrementRouteStats and getVikingFullStats", () => {
    it("tracks total routes", () => {
      incrementRouteStats({});
      incrementRouteStats({});
      incrementRouteStats({});
      const stats = getVikingFullStats();
      expect(stats.routes.total).toBeGreaterThanOrEqual(3);
    });

    it("tracks rule hits", () => {
      incrementRouteStats({ ruleHit: true });
      incrementRouteStats({ ruleHit: true });
      const stats = getVikingFullStats();
      expect(stats.routes.ruleHits).toBeGreaterThanOrEqual(2);
      expect(stats.routes.ruleHitRate).toBeGreaterThan(0);
    });

    it("tracks reroutes", () => {
      incrementRouteStats({ reroute: true });
      const stats = getVikingFullStats();
      expect(stats.routes.reroutes).toBeGreaterThanOrEqual(1);
    });

    it("includes optimizations", () => {
      const stats = getVikingFullStats();
      expect(stats.optimizations).toBeDefined();
      expect(typeof stats.optimizations.P0_dynamic_reroute).toBe("boolean");
      expect(typeof stats.optimizations.P1_post_compact_reroute).toBe("boolean");
      expect(typeof stats.optimizations.P2_model_switching).toBe("boolean");
      expect(typeof stats.optimizations.P3_parallel_routing).toBe("boolean");
      expect(typeof stats.optimizations.P4_rule_engine).toBe("boolean");
      expect(typeof stats.optimizations.P5_feedback_loop).toBe("boolean");
    });

    it("includes cache stats", () => {
      const stats = getVikingFullStats();
      expect(stats.cache).toBeDefined();
      expect(typeof stats.cache.size).toBe("number");
      expect(typeof stats.cache.maxSize).toBe("number");
      expect(typeof stats.cache.ttlMs).toBe("number");
    });
  });

  describe("getVikingOptimizations", () => {
    it("returns all P0-P5 optimization flags", () => {
      const opts = getVikingOptimizations();
      expect(opts).toHaveProperty("P0_dynamic_reroute");
      expect(opts).toHaveProperty("P1_post_compact_reroute");
      expect(opts).toHaveProperty("P2_model_switching");
      expect(opts).toHaveProperty("P3_parallel_routing");
      expect(opts).toHaveProperty("P4_rule_engine");
      expect(opts).toHaveProperty("P5_feedback_loop");
    });
  });

  describe("getVikingRouteTag", () => {
    it("returns Viking string when enabled", () => {
      const tag = getVikingRouteTag();
      expect(tag).toBe("Viking");
    });
  });

  describe("invalidateCacheForTool", () => {
    it("does not throw when cache is empty", () => {
      expect(() => invalidateCacheForTool("read")).not.toThrow();
    });
  });

  describe("classifyPromptComplexity extended", () => {
    it("classifies simple Chinese greetings", () => {
      const result = classifyPromptComplexity("你好");
      expect(result.complexity).toBe("simple");
      expect(result.preferredModel).toBeDefined();
      expect(result.preferredProvider).toBeDefined();
    });

    it("classifies simple English greetings", () => {
      const result = classifyPromptComplexity("hello");
      expect(result.complexity).toBe("simple");
      expect(result.maxTokens).toBe(50);
    });

    it("classifies complex keywords", () => {
      const result = classifyPromptComplexity("请重构这个模块的架构");
      expect(result.complexity).toBe("complex");
      expect(result.maxTokens).toBe(300);
      expect(result.preferredModel).toBeDefined();
    });

    it("classifies moderate keywords", () => {
      const result = classifyPromptComplexity("请编辑这个文件");
      expect(result.complexity).toBe("moderate");
      expect(result.preferredModel).toBeDefined();
      expect(result.preferredProvider).toBeDefined();
    });

    it("classifies default moderate without keywords", () => {
      const result = classifyPromptComplexity(
        "This is a moderately long prompt that needs some analysis",
      );
      expect(result.complexity).toBe("moderate");
      expect(result.preferredModel).toBeDefined();
      expect(result.preferredProvider).toBeDefined();
    });

    it("classifies as complex when timeline is long", () => {
      const longTimeline = "x".repeat(2500);
      const result = classifyPromptComplexity("do something", longTimeline);
      expect(result.complexity).toBe("complex");
    });

    it("handles empty prompt", () => {
      const result = classifyPromptComplexity("");
      expect(result.complexity).toBe("moderate");
      expect(result.preferredModel).toBeDefined();
    });

    it("handles whitespace-only prompt", () => {
      const result = classifyPromptComplexity("   ");
      expect(result.complexity).toBe("moderate");
    });
  });

  describe("vikingRouteWithFeedback", () => {
    const baseRouteResult: VikingRouteResult = {
      tools: new Set(["read", "exec", "write", "edit"]),
      files: new Set(["test.ts"]),
      promptLayer: "L1",
      skillsMode: "names",
      skipped: false,
      needsL1: false,
      l1Dates: [],
      needsL2: false,
    };

    it("handles context_overflow by reducing to core tools + L0", async () => {
      const feedback: VikingRouteFeedback = {
        routeResult: baseRouteResult,
        executionResult: "context_overflow",
      };

      const result = await vikingRouteWithFeedback({
        feedback,
        allTools: [{ name: "read" }, { name: "exec" }, { name: "write" }],
        model: {} as never,
        modelRegistry: {} as never,
        provider: "test",
      });

      expect(result).not.toBeNull();
      expect(result!.promptLayer).toBe("L0");
      expect(result!.skillsMode).toBe("names");
      expect(result!.needsL1).toBe(false);
      expect(result!.needsL2).toBe(false);
      expect(result!.files.size).toBe(0);
      expect(result!.tools.has("read") || result!.tools.has("exec")).toBe(true);
    });

    it("handles tool_missing by adding the missing tool and its pack", async () => {
      const feedback: VikingRouteFeedback = {
        routeResult: baseRouteResult,
        executionResult: "tool_missing",
        missingToolName: "web_search",
      };

      const result = await vikingRouteWithFeedback({
        feedback,
        allTools: [
          { name: "read" },
          { name: "exec" },
          { name: "write" },
          { name: "edit" },
          { name: "web_search" },
          { name: "web_fetch" },
        ],
        model: {} as never,
        modelRegistry: {} as never,
        provider: "test",
      });

      expect(result).not.toBeNull();
      expect(result!.tools.has("web_search")).toBe(true);
      expect(result!.tools.has("web_fetch")).toBe(true);
    });

    it("returns null for tool_missing when tool not in allTools", async () => {
      const feedback: VikingRouteFeedback = {
        routeResult: baseRouteResult,
        executionResult: "tool_missing",
        missingToolName: "nonexistent_tool",
      };

      const result = await vikingRouteWithFeedback({
        feedback,
        allTools: [{ name: "read" }, { name: "exec" }],
        model: {} as never,
        modelRegistry: {} as never,
        provider: "test",
      });

      expect(result).toBeNull();
    });

    it("returns null for success feedback", async () => {
      const feedback: VikingRouteFeedback = {
        routeResult: baseRouteResult,
        executionResult: "success",
      };

      const result = await vikingRouteWithFeedback({
        feedback,
        allTools: [{ name: "read" }],
        model: {} as never,
        modelRegistry: {} as never,
        provider: "test",
      });

      expect(result).toBeNull();
    });

    it("returns null for tool_error feedback", async () => {
      const feedback: VikingRouteFeedback = {
        routeResult: baseRouteResult,
        executionResult: "tool_error",
        errorMessage: "something went wrong",
      };

      const result = await vikingRouteWithFeedback({
        feedback,
        allTools: [{ name: "read" }],
        model: {} as never,
        modelRegistry: {} as never,
        provider: "test",
      });

      expect(result).toBeNull();
    });
  });

  describe("extractJsonBlock edge cases", () => {
    it("handles JSON with array inside", () => {
      const result = extractJsonBlock('{"items":[1,2,3]}');
      expect(result).toBe('{"items":[1,2,3]}');
    });

    it("handles JSON with nested arrays", () => {
      const result = extractJsonBlock('{"a":[[1,2],[3,4]]}');
      expect(result).toBe('{"a":[[1,2],[3,4]]}');
    });

    it("handles empty object", () => {
      const result = extractJsonBlock("{}");
      expect(result).toBe("{}");
    });

    it("handles JSON at end of text without closing context", () => {
      const result = extractJsonBlock('result: {"key":"val"}');
      expect(result).toBe('{"key":"val"}');
    });

    it("handles JSON with unicode escapes", () => {
      const result = extractJsonBlock('{"key":"\\u0041"}');
      expect(result).toBe('{"key":"\\u0041"}');
    });
  });
});
