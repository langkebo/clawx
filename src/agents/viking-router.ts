/**
 * OpenViking 分层路由器 v4
 *
 * 设计原则：大道至简
 * - 工具按"能力包"分类，路由模型做分类选择题
 * - core（read + exec）永远加载，保证 Agent 基础能力
 * - Skills 只给名称列表，主模型需要时自己 read SKILL.md
 * - 路由模型看到 L0 时间线，判断是否需要加载 L1（指定日期）/L2
 * - 路由失败自动回退全量
 *
 * 放置位置: src/agents/viking-router.ts
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { Api, Model } from "@mariozechner/pi-ai";
import type { ModelRegistry } from "@mariozechner/pi-coding-agent";
import { parse as parseYaml } from "yaml";
import { loadConfig } from "../config/config.js";
import { log } from "./pi-embedded-runner/logger.ts";
import type { PromptMode } from "./system-prompt.ts";

function readVikingConfig() {
  const cfg = loadConfig();
  const v = cfg.viking as Record<string, unknown> | undefined;
  return {
    enabled: typeof v?.enabled === "boolean" ? v.enabled : true,
    cacheMaxSize: typeof v?.cacheMaxSize === "number" ? v.cacheMaxSize : 1000,
    cacheTtlMs: typeof v?.cacheTtlMs === "number" ? v.cacheTtlMs : 5 * 60 * 1000,
    ruleEngine: typeof v?.ruleEngine === "boolean" ? v.ruleEngine : true,
    dynamicReroute: typeof v?.dynamicReroute === "boolean" ? v.dynamicReroute : true,
    postCompactReroute: typeof v?.postCompactReroute === "boolean" ? v.postCompactReroute : true,
    modelSwitching: typeof v?.modelSwitching === "boolean" ? v.modelSwitching : true,
    parallelRouting: typeof v?.parallelRouting === "boolean" ? v.parallelRouting : true,
    feedbackLoop: typeof v?.feedbackLoop === "boolean" ? v.feedbackLoop : true,
    routingModel: typeof v?.routingModel === "string" ? v.routingModel : undefined,
  };
}

interface CacheEntry {
  result: VikingRouteResult;
  timestamp: number;
}

const routingCache = new Map<string, CacheEntry>();

function getCacheKey(prompt: string, toolNames: string[]): string {
  const hash = createHash("md5");
  hash.update(prompt);
  hash.update(toolNames.toSorted().join(","));
  return hash.digest("hex");
}

function getCachedResult(prompt: string, toolNames: string[]): VikingRouteResult | null {
  const key = getCacheKey(prompt, toolNames);
  const entry = routingCache.get(key);
  if (entry && Date.now() - entry.timestamp < readVikingConfig().cacheTtlMs) {
    cacheHits++;
    log.info(`[viking] cache hit for prompt hash ${key.slice(0, 8)}`);
    return entry.result;
  }
  if (entry) {
    routingCache.delete(key);
  }
  cacheMisses++;
  return null;
}

function setCachedResult(prompt: string, toolNames: string[], result: VikingRouteResult): void {
  if (routingCache.size >= readVikingConfig().cacheMaxSize) {
    const oldestKey = routingCache.keys().next().value;
    if (oldestKey) {
      routingCache.delete(oldestKey);
    }
  }
  const key = getCacheKey(prompt, toolNames);
  routingCache.set(key, { result, timestamp: Date.now() });
}

export function clearRoutingCache(): void {
  routingCache.clear();
  cachedWorkspaceRules = null;
  cachedWorkspaceRulesDir = null;
  log.info("[viking] routing cache and rule cache cleared");
}

export function invalidateCacheForTool(toolName: string): void {
  let invalidated = 0;
  for (const [key, entry] of routingCache.entries()) {
    if (entry.result.tools.has(toolName)) {
      routingCache.delete(key);
      invalidated++;
    }
  }
  if (invalidated > 0) {
    log.info(`[viking] invalidated ${invalidated} cache entries for tool "${toolName}"`);
  }
}

export function getRoutingCacheStats(): {
  size: number;
  maxSize: number;
  ttlMs: number;
  hitRate: number;
} {
  return {
    size: routingCache.size,
    maxSize: readVikingConfig().cacheMaxSize,
    ttlMs: readVikingConfig().cacheTtlMs,
    hitRate: cacheHits / Math.max(cacheHits + cacheMisses, 1),
  };
}

let totalRoutes = 0;
let ruleHits = 0;
let rerouteCount = 0;

export function incrementRouteStats(opts: { ruleHit?: boolean; reroute?: boolean }): void {
  totalRoutes++;
  if (opts.ruleHit) {
    ruleHits++;
  }
  if (opts.reroute) {
    rerouteCount++;
  }
}

export function getVikingFullStats(): {
  enabled: boolean;
  cache: { size: number; maxSize: number; ttlMs: number; hitRate: number };
  routes: { total: number; ruleHits: number; ruleHitRate: number; reroutes: number };
} {
  return {
    enabled: readVikingConfig().enabled,
    cache: getRoutingCacheStats(),
    routes: {
      total: totalRoutes,
      ruleHits,
      ruleHitRate: ruleHits / Math.max(totalRoutes, 1),
      reroutes: rerouteCount,
    },
  };
}

export function getVikingRouteTag(): string | null {
  if (!readVikingConfig().enabled) {
    return null;
  }
  return "Viking";
}

export function getVikingOptimizations() {
  const cfg = readVikingConfig();
  return {
    P0_dynamic_reroute: cfg.dynamicReroute,
    P1_post_compact_reroute: cfg.postCompactReroute,
    P2_model_switching: cfg.modelSwitching,
    P3_parallel_routing: cfg.parallelRouting,
    P4_rule_engine: cfg.ruleEngine,
    P5_feedback_loop: cfg.feedbackLoop,
  };
}

let cacheHits = 0;
let cacheMisses = 0;

// ========================
// 类型
// ========================

export interface VikingRouteResult {
  tools: Set<string>;
  files: Set<string>;
  promptLayer: PromptMode;
  skillsMode: "names" | "summaries";
  skipped: boolean;
  /** 是否需要加载 L1 关键决策 */
  needsL1: boolean;
  /** 需要加载哪些日期的 L1 决策（空数组 = 不需要） */
  l1Dates: string[];
  /** 是否需要加载 L2 完整对话 */
  needsL2: boolean;
}

interface AgentToolLike {
  name: string;
  description?: string;
}

export interface SkillIndexEntry {
  name: string;
  description: string;
}

// ========================
// 能力包定义
// ========================

const CORE_TOOLS = new Set(["read", "exec"]);

const TOOL_PACKS: Record<string, { tools: string[]; description: string }> = {
  "base-ext": {
    tools: ["write", "edit", "apply_patch", "grep", "find", "ls", "process"],
    description: "文件编辑、搜索、目录操作、后台进程管理",
  },
  web: {
    tools: ["web_search", "web_fetch"],
    description: "搜索互联网、抓取网页内容",
  },
  browser: {
    tools: ["browser"],
    description: "控制浏览器打开和操作网页",
  },
  message: {
    tools: ["message"],
    description: "发送消息到钉钉、Telegram、Discord等通道",
  },
  media: {
    tools: ["canvas", "image", "image_generate", "pdf"],
    description: "图片分析/生成、画布展示、PDF提取",
  },
  infra: {
    tools: ["cron", "gateway", "session_status"],
    description: "定时任务、系统管理、状态查询、提醒",
  },
  tasks: {
    tools: ["tasks", "active_memory_recall", "active_memory_save"],
    description: "任务管理、后台作业跟踪、主动记忆召回与保存",
  },
  agents: {
    tools: [
      "agents_list",
      "sessions_list",
      "sessions_history",
      "sessions_send",
      "sessions_spawn",
      "sessions_yield",
      "subagents",
    ],
    description: "多Agent协作、子任务派发、会话管理、回合让出",
  },
  nodes: {
    tools: ["nodes"],
    description: "设备控制、摄像头、屏幕操作",
  },
};

// ========================
// 文件描述
// ========================

const FILE_DESCRIPTIONS: Record<string, string> = {
  "AGENTS.md": "Agent核心规则：会话流程、安全、模块索引",
  "SOUL.md": "Agent人格、语气、性格（任何对话都需要）",
  "TOOLS.md": "本地环境备注（SSH、摄像头、TTS语音等）",
  "IDENTITY.md": "Agent身份：名字、emoji、头像（任何对话都需要）",
  "USER.md": "用户信息和偏好（个性化回复需要）",
  "HEARTBEAT.md": "心跳任务清单",
  "BOOTSTRAP.md": "首次运行引导（仅首次需要）",
};

// ========================
// 判断是否跳过路由
// ========================

function shouldSkipRouting(): boolean {
  return !readVikingConfig().enabled;
}

// ========================
// 构建索引
// ========================

function buildPackIndex(): string {
  return Object.entries(TOOL_PACKS)
    .map(([name, pack]) => `  - ${name}: ${pack.description}`)
    .join("\n");
}

function buildSkillIndex(skills: SkillIndexEntry[]): string {
  if (skills.length === 0) {
    return "  (无)";
  }
  return skills.map((s) => `  - ${s.name}`).join("\n");
}

function buildFileIndex(fileNames: string[]): string {
  return fileNames
    .map((name) => {
      const desc = FILE_DESCRIPTIONS[name] ?? "workspace文件";
      return `  - ${name}: ${desc}`;
    })
    .join("\n");
}

// ========================
// 构建路由 prompt
// ========================

function buildRoutingPrompt(params: {
  userMessage: string;
  fileNames: string[];
  skills: SkillIndexEntry[];
  timeline?: string;
}): { system: string; user: string } {
  const system = `You are a resource router. Select capability packs and files needed for the task.
Reply with ONLY a JSON object, no other text, no markdown, no code fences.`;

  const packIndex = buildPackIndex();
  const skillIndex = buildSkillIndex(params.skills);
  const fileIndex = buildFileIndex(params.fileNames);

  const timelineSection = params.timeline
    ? `===== Conversation Timeline (L0) =====
${params.timeline}

`
    : "";

  const user = `User message: "${params.userMessage}"

${timelineSection}===== Capability Packs =====
Always loaded: read + exec
${packIndex}

===== Skills =====
${skillIndex}

===== Workspace Files =====
${fileIndex}

Reply JSON:
{"packs":["pack names"],"files":["file names"],"needsL1":false,"l1Dates":[],"needsL2":false,"reason":"brief reason"}

Rules:
1. For ANY conversation: always include SOUL.md, IDENTITY.md, USER.md in files.
2. File editing/coding: include "base-ext" pack.
3. Web search: include "web" pack.
4. Send messages/notifications: include "message" pack.
5. Scheduled tasks/reminders: include "infra" pack.
6. Task tracking/memory: include "tasks" pack.
7. Multi-agent/subtasks: include "agents" pack.
8. Simple chat: packs=[], files=["SOUL.md","IDENTITY.md","USER.md"].
9. If user references previous work from Timeline, set needsL1:true and l1Dates to relevant dates (YYYY-MM-DD).
10. If user needs exact original conversation/code, set needsL2:true.
11. When unsure: include more packs (cheap). Never leave packs empty if task needs tools beyond read+exec.`;

  log.info(`[viking] routing prompt chars: ${user.length}`);
  return { system, user };
}

// ========================
// 调用路由模型
// ========================

interface RoutingModelResult {
  packs: string[];
  files: string[];
  needsL1?: boolean;
  l1Dates?: string[];
  needsL2?: boolean;
}

/** 常见 provider 对应的环境变量名 */
const PROVIDER_ENV_MAP: Record<string, string> = {
  openai: "OPENAI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  google: "GEMINI_API_KEY",
  openrouter: "OPENROUTER_API_KEY",
  dashscope: "DASHSCOPE_API_KEY",
  moonshot: "MOONSHOT_API_KEY",
  siliconflow: "SILICONFLOW_API_KEY",
  ark: "ARK_API_KEY",
  groq: "GROQ_API_KEY",
  mistral: "MISTRAL_API_KEY",
  xai: "XAI_API_KEY",
  qwen: "QWEN_API_KEY",
  minimax: "MINIMAX_API_KEY",
  zhipu: "ZHIPU_API_KEY",
  deepseek: "DEEPSEEK_API_KEY",
  kimi: "KIMI_API_KEY",
  yi: "YI_API_KEY",
  baichuan: "BAICHUAN_API_KEY",
};

const FAILOVER_CONFIG = {
  maxRetries: 3,
  baseCooldownMs: 1000,
  maxCooldownMs: 30000,
  rateLimitedProfileRotations: 2,
  maxSameProviderRetries: 2,
  sameProviderCooldownMs: 5000,
};

export function isRateLimited(err: unknown): boolean {
  if (err instanceof Error) {
    return err.message.includes("429") || err.message.includes("rate limit");
  }
  return false;
}

function isRetryable(err: unknown): boolean {
  if (err instanceof Error) {
    const retryableCodes = ["429", "503", "502", "ETIMEDOUT", "ECONNRESET", "ENOTFOUND"];
    return retryableCodes.some((code) => err.message.includes(code));
  }
  return false;
}

export function classifyProviderError(err: unknown): {
  type: "rate_limit" | "auth" | "format" | "billing" | "transient" | "unknown";
  retryable: boolean;
  message: string;
} {
  if (!(err instanceof Error)) {
    return { type: "unknown", retryable: false, message: String(err) };
  }
  const msg = err.message.toLowerCase();
  if (msg.includes("429") || msg.includes("rate limit")) {
    return { type: "rate_limit", retryable: true, message: err.message };
  }
  if (msg.includes("401") || msg.includes("unauthorized") || msg.includes("invalid api key")) {
    return { type: "auth", retryable: false, message: err.message };
  }
  if (msg.includes("422") || msg.includes("invalid") || msg.includes("bad request")) {
    return { type: "format", retryable: false, message: err.message };
  }
  if (msg.includes("billing") || msg.includes("quota") || msg.includes("insufficient")) {
    return { type: "billing", retryable: false, message: err.message };
  }
  if (
    msg.includes("503") ||
    msg.includes("timeout") ||
    msg.includes("etimedout") ||
    msg.includes("econnreset")
  ) {
    return { type: "transient", retryable: true, message: err.message };
  }
  return { type: "unknown", retryable: false, message: err.message };
}

/** 判断是否是环境变量名而非真实 key */
function looksLikeEnvVarName(value: string): boolean {
  return /^[A-Z][A-Z0-9_]+$/.test(value);
}

/** 从环境变量中查找真实 apiKey */
function resolveApiKeyFromEnv(hint?: string, providerName?: string): string {
  if (hint && looksLikeEnvVarName(hint)) {
    const val = process.env[hint]?.trim();
    if (val && !looksLikeEnvVarName(val)) {
      return val;
    }
  }
  if (providerName) {
    const envVar = PROVIDER_ENV_MAP[providerName.toLowerCase()];
    if (envVar) {
      const val = process.env[envVar]?.trim();
      if (val && !looksLikeEnvVarName(val)) {
        return val;
      }
    }
  }
  return "";
}

async function callRoutingModel(params: {
  model: Model<Api>;
  modelRegistry: ModelRegistry;
  provider: string;
  system: string;
  user: string;
  maxTokens?: number;
}): Promise<RoutingModelResult | null> {
  let __lastError: Error | null = null;
  let rateLimitCount = 0;
  let sameProviderRetryCount = 0;
  let lastProviderAttempted: string | null = null;

  for (let attempt = 0; attempt < FAILOVER_CONFIG.maxRetries; attempt++) {
    try {
      const currentProvider = params.provider;
      if (currentProvider === lastProviderAttempted) {
        sameProviderRetryCount++;
        if (sameProviderRetryCount > FAILOVER_CONFIG.maxSameProviderRetries) {
          log.info(
            `[viking] same provider retry limit (${FAILOVER_CONFIG.maxSameProviderRetries}) reached for ${currentProvider}, aborting`,
          );
          return null;
        }
        if (sameProviderRetryCount > 1) {
          const cooldown = FAILOVER_CONFIG.sameProviderCooldownMs;
          log.info(`[viking] same provider retry ${sameProviderRetryCount}, waiting ${cooldown}ms`);
          await new Promise((resolve) => setTimeout(resolve, cooldown));
        }
      } else {
        sameProviderRetryCount = 0;
      }
      lastProviderAttempted = currentProvider;

      let apiKey = (await params.modelRegistry.getApiKey(params.model)) ?? "";
      if (!apiKey || looksLikeEnvVarName(apiKey)) {
        const envKey = resolveApiKeyFromEnv(apiKey || undefined, params.provider);
        if (envKey) {
          apiKey = envKey;
        }
      }

      const baseUrl =
        (typeof params.model.baseUrl === "string" ? params.model.baseUrl.trim() : "") ||
        "http://localhost:11434/v1";
      const modelId = params.model.id ?? params.model.name ?? "default";

      const url = `${baseUrl}/chat/completions`;
      log.info(`[viking] routing call: model=${modelId} url=${url} attempt=${attempt + 1}`);

      const baseBody = {
        model: modelId,
        messages: [
          { role: "system", content: params.system },
          { role: "user", content: params.user },
        ],
        max_tokens: params.maxTokens ?? 200,
        stream: false,
      };

      let responseText = "";
      for (const temp of [0, 1]) {
        try {
          const response = await fetch(url, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
            },
            body: JSON.stringify({ ...baseBody, temperature: temp }),
          });

          if (!response.ok) {
            const errText = await response.text().catch(() => "");

            if (response.status === 429) {
              rateLimitCount++;
              if (rateLimitCount <= FAILOVER_CONFIG.rateLimitedProfileRotations) {
                const cooldown = Math.min(
                  FAILOVER_CONFIG.baseCooldownMs * Math.pow(2, attempt),
                  FAILOVER_CONFIG.maxCooldownMs,
                );
                log.info(`[viking] rate limited, waiting ${cooldown}ms before retry`);
                await new Promise((resolve) => setTimeout(resolve, cooldown));
                continue;
              }
            }

            if (errText.includes("temperature")) {
              log.info(`[viking] temperature=${temp} not supported, retrying`);
              continue;
            }

            log.info(`[viking] routing API error ${response.status}: ${errText.slice(0, 200)}`);

            const classified = classifyProviderError(new Error(`${response.status}: ${errText}`));
            if (!classified.retryable) {
              return null;
            }

            __lastError = new Error(errText);
            break;
          }

          const data = (await response.json()) as {
            choices?: Array<{ message?: { content?: string } }>;
          };
          responseText = data.choices?.[0]?.message?.content ?? "";
          break;
        } catch (err) {
          log.info(`[viking] routing call failed (temp=${temp}): ${String(err)}`);
          __lastError = err as Error;

          if (isRetryable(err)) {
            const cooldown = Math.min(
              FAILOVER_CONFIG.baseCooldownMs * Math.pow(2, attempt),
              FAILOVER_CONFIG.maxCooldownMs,
            );
            log.info(`[viking] retryable error, waiting ${cooldown}ms before retry`);
            await new Promise((resolve) => setTimeout(resolve, cooldown));
            continue;
          }

          if (temp === 1) {
            return null;
          }
        }
      }

      if (!responseText) {
        continue;
      }

      log.info(`[viking] routing response: ${responseText.slice(0, 300)}`);

      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        log.info(`[viking] response not JSON, fallback to full`);
        return null;
      }

      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(jsonMatch[0]);
      } catch {
        log.info(`[viking] JSON parse failed, fallback to full`);
        return null;
      }
      return {
        packs: Array.isArray(parsed.packs) ? parsed.packs : [],
        files: Array.isArray(parsed.files) ? parsed.files : [],
        needsL1: parsed.needsL1 === true,
        l1Dates: Array.isArray(parsed.l1Dates)
          ? parsed.l1Dates.filter((d: unknown) => typeof d === "string")
          : [],
        needsL2: parsed.needsL2 === true,
      };
    } catch (err) {
      __lastError = err as Error;
      log.info(`[viking] routing attempt ${attempt + 1} failed: ${String(err)}`);

      if (isRetryable(err)) {
        const cooldown = Math.min(
          FAILOVER_CONFIG.baseCooldownMs * Math.pow(2, attempt),
          FAILOVER_CONFIG.maxCooldownMs,
        );
        await new Promise((resolve) => setTimeout(resolve, cooldown));
      }
    }
  }

  log.info(
    `[viking] routing call failed after ${FAILOVER_CONFIG.maxRetries} attempts, fallback to full`,
  );
  return null;
}

// ========================
// 展开能力包
// ========================

function expandPacks(packNames: string[]): Set<string> {
  const tools = new Set<string>(CORE_TOOLS);
  for (const name of packNames) {
    const pack = TOOL_PACKS[name];
    if (pack) {
      for (const tool of pack.tools) {
        tools.add(tool);
      }
    } else {
      log.info(`[viking] unknown pack "${name}", ignored`);
    }
  }
  return tools;
}

// ========================
// 主入口
// ========================

export async function vikingRoute(params: {
  prompt: string;
  tools: AgentToolLike[];
  fileNames: string[];
  skills: SkillIndexEntry[];
  model: Model<Api>;
  modelRegistry: ModelRegistry;
  provider: string;
  /** L0 时间线原始文本，供路由模型判断是否需要 L1/L2 */
  timeline?: string;
}): Promise<VikingRouteResult> {
  const allToolNames = new Set(params.tools.map((t) => t.name));
  const allFileNames = new Set(params.fileNames);
  const toolNameList = [...allToolNames];

  if (shouldSkipRouting()) {
    return {
      tools: allToolNames,
      files: allFileNames,
      promptLayer: "full",
      skillsMode: "summaries",
      skipped: true,
      needsL1: false,
      l1Dates: [],
      needsL2: false,
    };
  }

  if (!params.prompt || params.prompt.trim().length === 0) {
    return {
      tools: new Set(CORE_TOOLS),
      files: new Set<string>(),
      promptLayer: "L0" as PromptMode,
      skillsMode: "names",
      skipped: false,
      needsL1: false,
      l1Dates: [],
      needsL2: false,
    };
  }

  const cached = getCachedResult(params.prompt, toolNameList);
  if (cached) {
    return cached;
  }

  const { system, user } = buildRoutingPrompt({
    userMessage: params.prompt,
    fileNames: params.fileNames,
    skills: params.skills,
    timeline: params.timeline,
  });

  // P2: 根据 prompt 复杂度调整路由模型 max_tokens 和模型选择
  const complexity = classifyPromptComplexity(params.prompt, params.timeline);

  let routingModel = params.model;
  let routingProvider = params.provider;
  if (complexity.preferredModel && complexity.preferredProvider) {
    try {
      const allModels = params.modelRegistry.getAll();
      const altModel = allModels.find(
        (m) => m.id === complexity.preferredModel || m.name === complexity.preferredModel,
      );
      if (altModel) {
        routingModel = altModel;
        routingProvider = complexity.preferredProvider;
        log.info(
          `[viking] P2: using ${complexity.complexity} model ${complexity.preferredModel} via ${complexity.preferredProvider}`,
        );
      }
    } catch {
      log.info(`[viking] P2: fallback to default model (preferred model not found)`);
    }
  }

  const result = await callRoutingModel({
    model: routingModel,
    modelRegistry: params.modelRegistry,
    provider: routingProvider,
    system,
    user,
    maxTokens: complexity.maxTokens,
  });

  if (!result) {
    return {
      tools: allToolNames,
      files: allFileNames,
      promptLayer: "full",
      skillsMode: "summaries",
      skipped: false,
      needsL1: false,
      l1Dates: [],
      needsL2: false,
    };
  }

  const expandedTools = expandPacks(result.packs);

  const validTools = new Set<string>();
  for (const t of expandedTools) {
    if (allToolNames.has(t)) {
      validTools.add(t);
    }
  }
  for (const core of CORE_TOOLS) {
    if (allToolNames.has(core)) {
      validTools.add(core);
    }
  }

  const selectedFiles = new Set(result.files.filter((f) => allFileNames.has(f)));

  const promptLayer: PromptMode =
    validTools.size <= 2
      ? ("L0" as PromptMode)
      : validTools.size <= 12
        ? ("L1" as PromptMode)
        : "full";

  const routeResult: VikingRouteResult = {
    tools: validTools,
    files: selectedFiles,
    promptLayer,
    skillsMode: "names",
    skipped: false,
    needsL1: result.needsL1 ?? false,
    l1Dates: result.l1Dates ?? [],
    needsL2: result.needsL2 ?? false,
  };

  setCachedResult(params.prompt, toolNameList, routeResult);

  log.info(
    `[viking] routed: packs=[${result.packs.join(",")}] tools=[${[...validTools].join(",")}] ` +
      `files=[${[...selectedFiles].join(",")}] layer=${promptLayer} ` +
      `needsL1=${result.needsL1} l1Dates=[${(result.l1Dates ?? []).join(",")}] needsL2=${result.needsL2}`,
  );

  return {
    tools: validTools,
    files: selectedFiles,
    promptLayer,
    skillsMode: "names",
    skipped: false,
    needsL1: result.needsL1 ?? false,
    l1Dates: result.l1Dates ?? [],
    needsL2: result.needsL2 ?? false,
  };
}

// ========================
// Skills 名称+描述列表
// ========================

export function buildSkillNamesOnlyPrompt(skills: SkillIndexEntry[]): string {
  if (skills.length === 0) {
    return "";
  }
  const lines = skills.map((s) =>
    s.description ? `- ${s.name}: ${s.description}` : `- ${s.name}`,
  );
  return ["## Skills", ...lines, `Use \`read\` on the skill's SKILL.md when needed.`].join("\n");
}

// ========================
// P0: 动态再路由 — 工具调用失败时自动补充
// ========================

export interface VikingReRouteResult {
  addTools: Set<string>;
  removeTools: Set<string>;
  addPacks: string[];
}

export async function vikingReRoute(params: {
  currentTools: Set<string>;
  newRequest: string;
  allTools: AgentToolLike[];
  model: Model<Api>;
  modelRegistry: ModelRegistry;
  provider: string;
}): Promise<VikingReRouteResult> {
  if (!readVikingConfig().enabled) {
    return { addTools: new Set(), removeTools: new Set(), addPacks: [] };
  }

  const currentToolList = [...params.currentTools].toSorted();
  const allToolNames = params.allTools.map((t) => t.name);
  const missingTools = allToolNames.filter((n) => !params.currentTools.has(n));

  if (missingTools.length === 0) {
    return { addTools: new Set(), removeTools: new Set(), addPacks: [] };
  }

  const packIndex = buildPackIndex();

  const system = `You are a tool supplement router. The agent is missing a tool it needs.
Reply with ONLY a JSON object, no other text, no markdown, no code fences.`;

  const user = `Current tools: [${currentToolList.join(", ")}]
Available but not loaded: [${missingTools.join(", ")}]
Capability packs:
${packIndex}

The agent encountered: "${params.newRequest}"

Which packs should be added? Reply JSON:
{"packs":["pack names"],"files":[],"reason":"brief reason"}`;

  const result = await callRoutingModel({
    model: params.model,
    modelRegistry: params.modelRegistry,
    provider: params.provider,
    system,
    user,
    maxTokens: 150,
  });

  if (!result || !result.packs || result.packs.length === 0) {
    return { addTools: new Set(), removeTools: new Set(), addPacks: [] };
  }

  const expandedTools = expandPacks(result.packs);
  const addTools = new Set<string>();
  for (const t of expandedTools) {
    if (!params.currentTools.has(t) && params.allTools.some((at) => at.name === t)) {
      addTools.add(t);
    }
  }

  log.info(
    `[viking] re-route: addPacks=[${result.packs.join(",")}] addTools=[${[...addTools].join(",")}]`,
  );

  return { addTools, removeTools: new Set(), addPacks: result.packs };
}

// ========================
// P5: 验证反馈回路 — 路由自纠正
// ========================

export type RouteFeedbackType = "tool_missing" | "tool_error" | "context_overflow" | "success";

export interface VikingRouteFeedback {
  routeResult: VikingRouteResult;
  executionResult: RouteFeedbackType;
  missingToolName?: string;
  errorMessage?: string;
}

function reverseLookupPack(toolName: string): string | null {
  for (const [packName, pack] of Object.entries(TOOL_PACKS)) {
    if (pack.tools.includes(toolName)) {
      return packName;
    }
  }
  return null;
}

export async function vikingRouteWithFeedback(params: {
  feedback: VikingRouteFeedback;
  allTools: AgentToolLike[];
  model: Model<Api>;
  modelRegistry: ModelRegistry;
  provider: string;
}): Promise<VikingRouteResult | null> {
  if (!readVikingConfig().enabled) {
    return null;
  }

  const fb = params.feedback;

  if (fb.executionResult === "tool_missing" && fb.missingToolName) {
    const tool = params.allTools.find((t) => t.name === fb.missingToolName);
    if (!tool) {
      return null;
    }

    const packName = reverseLookupPack(fb.missingToolName);
    const addTools = new Set(fb.routeResult.tools);
    addTools.add(fb.missingToolName);

    if (packName) {
      const pack = TOOL_PACKS[packName];
      if (pack) {
        for (const t of pack.tools) {
          if (params.allTools.some((at) => at.name === t)) {
            addTools.add(t);
          }
        }
      }
    }

    log.info(
      `[viking] feedback: tool_missing=${fb.missingToolName} pack=${packName ?? "none"} added tools=[${[...addTools].filter((t) => !fb.routeResult.tools.has(t)).join(",")}]`,
    );

    const toolCount = addTools.size;
    const promptLayer: PromptMode = toolCount <= 2 ? "L0" : toolCount <= 12 ? "L1" : "full";

    return {
      tools: addTools,
      files: fb.routeResult.files,
      promptLayer,
      skillsMode: fb.routeResult.skillsMode,
      skipped: false,
      needsL1: fb.routeResult.needsL1,
      l1Dates: fb.routeResult.l1Dates,
      needsL2: fb.routeResult.needsL2,
    };
  }

  if (fb.executionResult === "context_overflow") {
    log.info(`[viking] feedback: context_overflow, downgrading to L0`);
    return {
      ...fb.routeResult,
      promptLayer: "L0" as PromptMode,
      skillsMode: "names",
    };
  }

  return null;
}

// ========================
// P2: 路由模型动态切换
// ========================

export interface RoutingModelChoice {
  maxTokens: number;
  complexity: "simple" | "moderate" | "complex";
  preferredModel?: string;
  preferredProvider?: string;
}

export function classifyPromptComplexity(prompt: string, timeline?: string): RoutingModelChoice {
  const trimmed = prompt.trim();

  const simplePatterns =
    /^(你好|hi|hello|谢谢|好的|是|否|ok|yes|no|嗯|对|行|拜|再见|bye)[!！。.？?~～]*$/i;
  if (simplePatterns.test(trimmed)) {
    return {
      maxTokens: 50,
      complexity: "simple",
      preferredModel: "Qwen/Qwen2.5-7B-Instruct",
      preferredProvider: "siliconflow",
    };
  }

  const complexKeywords =
    /重构|架构|迁移|安全|优化|分析|对比|设计|review|调试|排查|修复|部署|监控|测试|性能|集成|升级|合并/i;
  if (complexKeywords.test(trimmed) || (timeline && timeline.length > 2000)) {
    return {
      maxTokens: 300,
      complexity: "complex",
      preferredModel: "Qwen/Qwen2.5-72B-Instruct",
      preferredProvider: "siliconflow",
    };
  }

  const moderateKeywords = /编辑|修改|搜索|查找|发送|创建|删除|运行|执行|安装|配置|查看|列出/i;
  if (moderateKeywords.test(trimmed)) {
    return {
      maxTokens: 200,
      complexity: "moderate",
      preferredModel: "Qwen/Qwen2.5-32B-Instruct",
      preferredProvider: "siliconflow",
    };
  }

  return {
    maxTokens: 150,
    complexity: "moderate",
  };
}

// ========================
// P3: 并行路由能力 — 多子任务同时路由
// ========================

export interface ParallelRouteTask {
  id: string;
  prompt: string;
  fileNames?: string[];
  skills?: Array<{ name: string; description: string }>;
}

export interface ParallelRouteResult {
  id: string;
  route: VikingRouteResult;
  error?: string;
}

export async function vikingParallelRoute(params: {
  tasks: ParallelRouteTask[];
  tools: AgentToolLike[];
  model: Model<Api>;
  modelRegistry: ModelRegistry;
  provider: string;
  workspaceDir?: string;
  concurrency?: number;
}): Promise<ParallelRouteResult[]> {
  if (!readVikingConfig().enabled || params.tasks.length === 0) {
    return [];
  }

  const concurrency = params.concurrency ?? 3;
  const results: ParallelRouteResult[] = [];
  const queue = [...params.tasks];

  const worker = async (): Promise<void> => {
    while (queue.length > 0) {
      const task = queue.shift();
      if (!task) {
        break;
      }

      try {
        const ruleResult = tryRuleBasedRoute({
          fileNames: task.fileNames ?? [],
          promptLength: task.prompt?.length ?? 0,
          hasFileContext: (task.fileNames?.length ?? 0) > 0,
          workspaceDir: params.workspaceDir,
        });

        const route =
          ruleResult ??
          (await vikingRoute({
            prompt: task.prompt,
            tools: params.tools,
            fileNames: task.fileNames ?? [],
            skills: task.skills ?? [],
            model: params.model,
            modelRegistry: params.modelRegistry,
            provider: params.provider,
          }));

        results.push({ id: task.id, route });
      } catch (err) {
        results.push({
          id: task.id,
          route: {
            tools: new Set(params.tools.map((t) => t.name)),
            files: new Set<string>(),
            promptLayer: "full",
            skillsMode: "summaries",
            skipped: false,
            needsL1: false,
            l1Dates: [],
            needsL2: false,
          },
          error: String(err),
        });
      }
    }
  };

  const workers = Array.from({ length: Math.min(concurrency, params.tasks.length) }, () =>
    worker(),
  );
  await Promise.all(workers);

  log.info(`[viking] parallel route: ${results.length}/${params.tasks.length} tasks completed`);
  return results;
}
// ========================

export interface VikingRule {
  when: {
    filePatterns?: string[];
    promptMaxLength?: number;
    noFileContext?: boolean;
  };
  apply: {
    packs: string[];
    promptMode: PromptMode;
  };
}

const DEFAULT_RULES: VikingRule[] = [
  {
    when: { promptMaxLength: 50, noFileContext: true },
    apply: { packs: [], promptMode: "L0" },
  },
];

function loadRulesFromDir(rulesDir: string): VikingRule[] {
  if (!existsSync(rulesDir)) {
    return [];
  }
  const rules: VikingRule[] = [];
  try {
    const entries = readdirSync(rulesDir).filter((f) => f.endsWith(".yml") || f.endsWith(".yaml"));
    for (const entry of entries) {
      try {
        const content = readFileSync(join(rulesDir, entry), "utf-8");
        const parsed = parseYaml(content);
        if (Array.isArray(parsed)) {
          for (const item of parsed) {
            if (item?.when && item?.apply) {
              rules.push(item as VikingRule);
            }
          }
        } else if (parsed?.when && parsed?.apply) {
          rules.push(parsed as VikingRule);
        }
      } catch (err) {
        log.warn(`[viking] failed to load rule file ${entry}: ${String(err)}`);
      }
    }
    if (rules.length > 0) {
      log.info(`[viking] loaded ${rules.length} rule(s) from ${rulesDir}`);
    }
  } catch (err) {
    log.warn(`[viking] failed to read rules dir ${rulesDir}: ${String(err)}`);
  }
  return rules;
}

let cachedWorkspaceRules: VikingRule[] | null = null;
let cachedWorkspaceRulesDir: string | null = null;

function getWorkspaceRules(workspaceDir?: string): VikingRule[] {
  if (!workspaceDir) {
    return [];
  }
  const rulesDir = join(workspaceDir, ".viking", "rules");
  if (rulesDir === cachedWorkspaceRulesDir && cachedWorkspaceRules !== null) {
    return cachedWorkspaceRules;
  }
  cachedWorkspaceRules = loadRulesFromDir(rulesDir);
  cachedWorkspaceRulesDir = rulesDir;
  return cachedWorkspaceRules;
}

function matchRule(
  rules: VikingRule[],
  context: {
    fileNames: string[];
    promptLength: number;
    hasFileContext: boolean;
  },
): VikingRule | null {
  for (const rule of rules) {
    const w = rule.when;
    if (w.promptMaxLength !== undefined && context.promptLength > w.promptMaxLength) {
      continue;
    }
    if (w.noFileContext === true && context.hasFileContext) {
      continue;
    }
    if (w.filePatterns && w.filePatterns.length > 0) {
      const matches = context.fileNames.some((fn) =>
        w.filePatterns!.some((pat) => {
          const regex = new RegExp(pat.replace(/\*/g, ".*").replace(/\?/g, "."));
          return regex.test(fn);
        }),
      );
      if (!matches) {
        continue;
      }
    }
    return rule;
  }
  return null;
}

export function tryRuleBasedRoute(context: {
  fileNames: string[];
  promptLength: number;
  hasFileContext: boolean;
  workspaceDir?: string;
}): VikingRouteResult | null {
  const workspaceRules = getWorkspaceRules(context.workspaceDir);
  const allRules = [...workspaceRules, ...DEFAULT_RULES];
  const rule = matchRule(allRules, context);
  if (!rule) {
    return null;
  }

  const tools = expandPacks(rule.apply.packs);
  log.info(
    `[viking] rule-based route matched: packs=[${rule.apply.packs.join(",")}] mode=${rule.apply.promptMode}`,
  );

  return {
    tools,
    files: new Set<string>(),
    promptLayer: rule.apply.promptMode,
    skillsMode: "names",
    skipped: false,
    needsL1: false,
    l1Dates: [],
    needsL2: false,
  };
}
