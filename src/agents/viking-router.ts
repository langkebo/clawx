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
import type { Api, Model } from "@mariozechner/pi-ai";
import type { ModelRegistry } from "@mariozechner/pi-coding-agent";
import { log } from "./pi-embedded-runner/logger.ts";
import type { PromptMode } from "./system-prompt.ts";

// ========================
// 总开关
// ========================
const VIKING_ENABLED = true;

// ========================
// 路由缓存
// ========================

interface CacheEntry {
  result: VikingRouteResult;
  timestamp: number;
}

const routingCache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5分钟
const CACHE_MAX_SIZE = 1000;

function getCacheKey(prompt: string, toolNames: string[]): string {
  const hash = createHash("md5");
  hash.update(prompt);
  hash.update(toolNames.sort().join(","));
  return hash.digest("hex");
}

function getCachedResult(prompt: string, toolNames: string[]): VikingRouteResult | null {
  const key = getCacheKey(prompt, toolNames);
  const entry = routingCache.get(key);
  if (entry && Date.now() - entry.timestamp < CACHE_TTL_MS) {
    log.info(`[viking] cache hit for prompt hash ${key.slice(0, 8)}`);
    return entry.result;
  }
  return null;
}

function setCachedResult(prompt: string, toolNames: string[], result: VikingRouteResult): void {
  if (routingCache.size >= CACHE_MAX_SIZE) {
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
  log.info("[viking] routing cache cleared");
}

export function getRoutingCacheStats(): { size: number; maxSize: number; ttlMs: number } {
  return {
    size: routingCache.size,
    maxSize: CACHE_MAX_SIZE,
    ttlMs: CACHE_TTL_MS,
  };
}

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
  "web": {
    tools: ["web_search", "web_fetch"],
    description: "搜索互联网、抓取网页内容",
  },
  "browser": {
    tools: ["browser"],
    description: "控制浏览器打开和操作网页",
  },
  "message": {
    tools: ["message"],
    description: "发送消息到钉钉、Telegram、Discord等通道",
  },
  "media": {
    tools: ["canvas", "image"],
    description: "图片生成、画布展示和截图",
  },
  "infra": {
    tools: ["cron", "gateway", "session_status"],
    description: "定时任务、系统管理、状态查询、提醒",
  },
  "agents": {
    tools: ["agents_list", "sessions_list", "sessions_history", "sessions_send", "sessions_spawn", "subagents"],
    description: "多Agent协作、子任务派发、会话管理",
  },
  "nodes": {
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
  return !VIKING_ENABLED;
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
  if (skills.length === 0) return "  (无)";
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
Reply with ONLY a JSON object, no other text, no markdown.`;

  const packIndex = buildPackIndex();
  const skillIndex = buildSkillIndex(params.skills);
  const fileIndex = buildFileIndex(params.fileNames);

  const timelineSection = params.timeline
    ? `===== Conversation Timeline (L0) =====
This is a brief timeline of previous conversations. Each line has a date. Use it to determine if the user is referencing past work, and which dates are relevant.
${params.timeline}

`
    : "";

  const user = `User message: "${params.userMessage}"

${timelineSection}===== Capability Packs (select needed) =====
Always loaded: read + exec (do not select)
${packIndex}

===== Skills (for reference, all run via exec) =====
${skillIndex}

===== Workspace Files (select needed) =====
${fileIndex}

Reply JSON:
{"packs":["pack names"],"files":["file names"],"needsL1":false,"l1Dates":[],"needsL2":false,"reason":"brief reason"}

Rules:
1. SKILLS: If the task matches any skill above, no extra pack needed (exec is always loaded). But if the skill also needs web/message/etc, include those packs.
2. For ANY conversation: include SOUL.md, IDENTITY.md, USER.md.
3. File editing/coding: include "base-ext".
4. Web search: include "web".
5. Send messages/notifications: include "message".
6. Scheduled tasks/reminders: include "infra".
7. Simple chat: packs=[], files=["SOUL.md","IDENTITY.md","USER.md"].
8. When unsure: include more packs (cheap). Do NOT leave packs empty if the task needs tools beyond read+exec.
9. If the user references previous work shown in the Timeline, set needsL1: true and l1Dates to the relevant dates from the Timeline (format: "YYYY-MM-DD"). Only include dates that appear in the Timeline and are relevant to the user's question.
10. If the user needs the exact original conversation or full code (e.g., "把完整代码调出来", "看之前的详细对话"), set needsL2: true.
11. If no Timeline is provided or the user's question is unrelated to past work, set needsL1: false, l1Dates: [], needsL2: false.`;

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
  if (msg.includes("503") || msg.includes("timeout") || msg.includes("etimedout") || msg.includes("econnreset")) {
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
    if (val && !looksLikeEnvVarName(val)) return val;
  }
  if (providerName) {
    const envVar = PROVIDER_ENV_MAP[providerName.toLowerCase()];
    if (envVar) {
      const val = process.env[envVar]?.trim();
      if (val && !looksLikeEnvVarName(val)) return val;
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
}): Promise<RoutingModelResult | null> {
  let lastError: Error | null = null;
  let rateLimitCount = 0;
  
  for (let attempt = 0; attempt < FAILOVER_CONFIG.maxRetries; attempt++) {
    try {
      let apiKey = await params.modelRegistry.getApiKey(params.model) ?? "";
      if (!apiKey || looksLikeEnvVarName(apiKey)) {
        const envKey = resolveApiKeyFromEnv(
          apiKey || undefined,
          params.provider,
        );
        if (envKey) apiKey = envKey;
      }

      const baseUrl = (
        typeof params.model.baseUrl === "string" ? params.model.baseUrl.trim() : ""
      ) || "http://localhost:11434/v1";
      const modelId = params.model.id ?? params.model.name ?? "default";

      const url = `${baseUrl}/chat/completions`;
      log.info(`[viking] routing call: model=${modelId} url=${url} attempt=${attempt + 1}`);

      const baseBody = {
        model: modelId,
        messages: [
          { role: "system", content: params.system },
          { role: "user", content: params.user },
        ],
        max_tokens: 200,
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
                  FAILOVER_CONFIG.maxCooldownMs
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
            
            lastError = new Error(errText);
            break;
          }

          const data = (await response.json()) as {
            choices?: Array<{ message?: { content?: string } }>;
          };
          responseText = data.choices?.[0]?.message?.content ?? "";
          break;
        } catch (err) {
          log.info(`[viking] routing call failed (temp=${temp}): ${String(err)}`);
          lastError = err as Error;
          
          if (isRetryable(err)) {
            const cooldown = Math.min(
              FAILOVER_CONFIG.baseCooldownMs * Math.pow(2, attempt),
              FAILOVER_CONFIG.maxCooldownMs
            );
            log.info(`[viking] retryable error, waiting ${cooldown}ms before retry`);
            await new Promise((resolve) => setTimeout(resolve, cooldown));
            continue;
          }
          
          if (temp === 1) return null;
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

      const parsed = JSON.parse(jsonMatch[0]);
      return {
        packs: Array.isArray(parsed.packs) ? parsed.packs : [],
        files: Array.isArray(parsed.files) ? parsed.files : [],
        needsL1: parsed.needsL1 === true,
        l1Dates: Array.isArray(parsed.l1Dates) ? parsed.l1Dates.filter((d: unknown) => typeof d === "string") : [],
        needsL2: parsed.needsL2 === true,
      };
    } catch (err) {
      lastError = err as Error;
      log.info(`[viking] routing attempt ${attempt + 1} failed: ${String(err)}`);
      
      if (isRetryable(err)) {
        const cooldown = Math.min(
          FAILOVER_CONFIG.baseCooldownMs * Math.pow(2, attempt),
          FAILOVER_CONFIG.maxCooldownMs
        );
        await new Promise((resolve) => setTimeout(resolve, cooldown));
      }
    }
  }
  
  log.info(`[viking] routing call failed after ${FAILOVER_CONFIG.maxRetries} attempts, fallback to full`);
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

  const result = await callRoutingModel({
    model: params.model,
    modelRegistry: params.modelRegistry,
    provider: params.provider,
    system,
    user,
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
    if (allToolNames.has(t)) validTools.add(t);
  }
  for (const core of CORE_TOOLS) {
    if (allToolNames.has(core)) validTools.add(core);
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
  if (skills.length === 0) return "";
  const lines = skills.map((s) =>
    s.description ? `- ${s.name}: ${s.description}` : `- ${s.name}`
  );
  return [
    "## Skills",
    ...lines,
    `Use \`read\` on the skill's SKILL.md when needed.`,
  ].join("\n");
}
