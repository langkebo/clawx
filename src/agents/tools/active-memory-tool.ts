import { Type } from "@sinclair/typebox";
import type { OpenClawConfig } from "../../config/config.js";
import { getMemorySearchManager } from "../../memory/index.js";
import { resolveSessionAgentId } from "../agent-scope.js";
import { resolveMemorySearchConfig } from "../memory-search.js";
import type { AnyAgentTool } from "./common.js";
import { jsonResult, readStringParam } from "./common.js";

const ActiveMemoryRecallSchema = Type.Object({
  topic: Type.String({
    description:
      "What to recall: a person name, project, decision, preference, date, or any topic the user may have discussed before.",
  }),
  context: Type.Optional(
    Type.String({
      description:
        "Optional extra context to narrow the recall (e.g., 'last week', 'about deployment').",
    }),
  ),
});

const ActiveMemorySaveSchema = Type.Object({
  content: Type.String({
    description: "The fact, preference, or decision to save into memory for future recall.",
  }),
  category: Type.Optional(
    Type.String({
      description: "Category tag: preference, decision, person, project, fact, todo, or custom.",
    }),
  ),
});

const ACTIVE_MEMORY_SYSTEM_HINT = [
  "Active Memory: you MUST call active_memory_recall before answering any question about prior work,",
  "decisions, dates, people, preferences, or todos. If the user shares new preferences or makes",
  "decisions, proactively call active_memory_save to persist them. This ensures continuity across sessions.",
].join(" ");

export function getActiveMemorySystemHint(): string {
  return ACTIVE_MEMORY_SYSTEM_HINT;
}

function resolveMemoryContext(options: { config?: OpenClawConfig; agentSessionKey?: string }) {
  const cfg = options.config;
  if (!cfg) {
    return null;
  }
  const agentId = resolveSessionAgentId({
    sessionKey: options.agentSessionKey,
    config: cfg,
  });
  if (!resolveMemorySearchConfig(cfg, agentId)) {
    return null;
  }
  return { cfg, agentId };
}

export function createActiveMemoryRecallTool(options: {
  config?: OpenClawConfig;
  agentSessionKey?: string;
}): AnyAgentTool | null {
  const ctx = resolveMemoryContext(options);
  if (!ctx) {
    return null;
  }
  const { cfg, agentId } = ctx;

  return {
    label: "Active Memory Recall",
    name: "active_memory_recall",
    description:
      "Automatically recall prior context: searches MEMORY.md + memory/*.md for information about a person, project, decision, preference, or past event. Call this BEFORE answering questions about anything the user may have mentioned before.",
    parameters: ActiveMemoryRecallSchema,
    execute: async (_toolCallId, params) => {
      const topic = readStringParam(params, "topic", { required: true });
      const context = readStringParam(params, "context");
      const query = context ? `${topic} ${context}` : topic;

      const { manager, error } = await getMemorySearchManager({ cfg, agentId });
      if (!manager) {
        return jsonResult({ recalled: false, results: [], disabled: true, error });
      }

      try {
        const results = await manager.search(query, {
          maxResults: 5,
          minScore: 0.3,
          sessionKey: options.agentSessionKey,
        });

        if (results.length === 0) {
          return jsonResult({
            recalled: false,
            results: [],
            hint: `No prior memory found for "${topic}". Ask the user if they'd like to save this information.`,
          });
        }

        const summarized = results.map((r) => ({
          path: r.path,
          snippet: r.snippet?.trim() ?? "",
          score: r.score,
          startLine: r.startLine,
          endLine: r.endLine,
        }));

        return jsonResult({
          recalled: true,
          results: summarized,
          hint: `Found ${summarized.length} memory snippet(s) about "${topic}". Use this context when responding.`,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return jsonResult({ recalled: false, results: [], disabled: true, error: message });
      }
    },
  };
}

export function createActiveMemorySaveTool(options: {
  config?: OpenClawConfig;
  agentSessionKey?: string;
}): AnyAgentTool | null {
  const ctx = resolveMemoryContext(options);
  if (!ctx) {
    return null;
  }
  const { cfg, agentId } = ctx;

  return {
    label: "Active Memory Save",
    name: "active_memory_save",
    description:
      "Proactively save a user preference, decision, or important fact to MEMORY.md for future recall. Use this when the user expresses a clear preference, makes a decision, or shares information worth remembering.",
    parameters: ActiveMemorySaveSchema,
    execute: async (_toolCallId, params) => {
      const content = readStringParam(params, "content", { required: true });
      const category = readStringParam(params, "category") ?? "fact";

      const hasInvalidChars = category.includes("/") || category.includes("\\") || category.includes("..") || Array.from(category).some((c) => c.charCodeAt(0) <= 0x1f);
      if (hasInvalidChars) {
        return jsonResult({ saved: false, error: "Invalid category name" });
      }

      const { manager, error } = await getMemorySearchManager({ cfg, agentId });
      if (!manager) {
        return jsonResult({ saved: false, disabled: true, error });
      }

      try {
        const status = manager.status();
        const workspaceDir = status.workspaceDir;
        if (!workspaceDir) {
          return jsonResult({ saved: false, error: "Workspace directory not available" });
        }

        const fs = await import("node:fs/promises");
        const path = await import("node:path");
        const memoryDir = path.join(workspaceDir, "memory");
        await fs.mkdir(memoryDir, { recursive: true });

        const timestamp = new Date().toISOString().split("T")[0];
        const categoryFile = path.join(memoryDir, `${category}.md`);

        let existing = "";
        try {
          existing = await fs.readFile(categoryFile, "utf-8");
        } catch {
          existing = `# ${category.charAt(0).toUpperCase() + category.slice(1)}\n\n`;
        }

        const entry = `- [${timestamp}] ${content}`;
        const updated = existing.trimEnd() + "\n" + entry + "\n";
        await fs.writeFile(categoryFile, updated, "utf-8");

        if (typeof manager.sync === "function") {
          try {
            await manager.sync();
          } catch (err: unknown) {
            console.warn(
              `active-memory: sync failed after save: ${err instanceof Error ? err.message : String(err)}`,
            );
          }
        }

        return jsonResult({
          saved: true,
          category,
          content,
          path: `memory/${category}.md`,
          hint: `Saved to memory/${category}.md. This will be available for future recall via active_memory_recall.`,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return jsonResult({ saved: false, error: message });
      }
    },
  };
}
