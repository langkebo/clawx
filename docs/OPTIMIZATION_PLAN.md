# Viking × Claude Code 精华融合优化方案

> 基于 Claude Code 官方架构分析，对比 Viking 当前实现，提取 Claude Code 精华，
> 提出可落地的下一步优化建议。

---

## 一、MERGE_PLAN 执行状态检查

| 步骤               | 状态        | 说明                                     |
| ------------------ | ----------- | ---------------------------------------- |
| Step 1: 环境准备   | ✅ 部分完成 | `.viking-backup/` 已创建；升级分支未创建 |
| Step 2: Fetch 上游 | ❌ 未完成   | upstream remote 未添加，网络受限         |
| Step 3: Merge      | ❌ 未完成   | 依赖 Step 2                              |
| Step 4-10          | ❌ 未完成   | 依赖 Merge                               |

**当前 git 状态**：已有本地修改（未提交），包括：

- 已删除冗余备份文件（`.bak`, `兼容opy.ts`）✅
- 已修改核心文件（system-prompt, viking-router, tool-policy 等）
- 已新增工具文件（active-memory, image-generate, pdf, sessions-yield, tasks）
- 已添加安全修复（ws-preauth）

**建议**：先提交当前修改，再继续 MERGE_PLAN。

---

## 二、Claude Code 架构精华提炼

深入分析 Claude Code 官方文档后，提取以下 **7 大核心设计精华**：

### 精华 1：Tool Search — 动态工具发现与按需加载

**Claude Code 做法**：

- 不把所有工具定义塞进 context window
- Agent 只看到一个工具摘要目录
- 需要时动态搜索，加载 3-5 个最相关工具
- 已加载工具在后续 turn 复用
- context 紧张时自动 compact 掉旧工具，需要时重新搜索
- `auto:N` 阈值：工具定义占比超过 N% 时自动激活

**Viking 当前做法**：

- 用路由模型全量做"能力包"选择题
- 一次性挑选所有需要的工具/文件/skills
- 缓存 5 分钟 TTL

**差距**：Viking 是"一次性预判"，Claude Code 是"持续按需发现"。Viking 预判不准的后果更严重（整个会话缺工具）。

---

### 精华 2：Agentic Loop 三阶段模型

**Claude Code 做法**：

- **Gather Context** → **Take Action** → **Verify Results**
- 三阶段自然交织，不是线性流水线
- 每个 turn 都可以重新评估需要什么上下文
- Verification 是内置核心，不只是"运行测试"

**Viking 当前做法**：

- 路由发生在 turn 1 之前，后续无法调整
- 没有 verify 阶段的反馈回路

**差距**：Viking 路由是一次性的，无法中途纠偏。

---

### 精华 3：Context Window 精细管理

**Claude Code 做法**：

- 自动 compact：旧工具输出优先清理 → 对话摘要 → 保留关键代码片段
- CLAUDE.md 控制持久指令 < 200 行
- `@path` 导入机制：按需加载而非全量注入
- `/context` 命令实时查看 context 占用
- thrashing 检测：compact 后立即填满则停止而非循环

**Viking 当前做法**：

- L0/L1/L2 分层是优秀的 context 策略
- 但缺乏 compact 后的动态工具重新分配

**亮点**：Viking 的 L0/L1/L2 分层比 Claude Code 更精细（Claude Code 只有 full vs compact）。

---

### 精华 4：Subagent 并行 + 上下文隔离

**Claude Code 做法**：

- 每个 subagent 独立 context window，并行执行
- 父 agent 只接收 subagent 最终消息
- subagent 可限定工具子集（如只读）
- subagent 可指定不同 model（轻任务用 Haiku/Sonnet，重任务用 Opus）
- subagent 不能再嵌套 subagent

**Viking 当前做法**：

- viking-task-registry 提供了后台任务系统
- 但缺乏并行路由能力

**差距**：Claude Code 的 subagent 是一等公民，Viking 的后台任务更像是辅助。

---

### 精华 5：多模型分层 — 精准投放算力

**Claude Code 做法**：

- 路由/决策：轻量模型 (Haiku/Sonnet)
- 复杂编码/推理：重量模型 (Opus)
- subagent 可独立指定 model
- fast mode：Opus 4.6 的快速变体

**Viking 当前做法**：

- 路由模型可配置（viking-router.ts 中支持多种国产模型）
- vLLM 本地路由适配（viking-routervllm.ts）
- 但路由模型选择是全局配置，不随任务类型动态切换

**亮点**：Viking 的国产 Provider 生态（18个）远超 Claude Code 的 3 个模型。

---

### 精华 6：持久记忆体系

**Claude Code 做法**：

- CLAUDE.md：用户写的持久指令（项目级/用户级/组织级）
- Auto Memory：Claude 自己积累的学习笔记（前 200 行/25KB 自动加载）
- `.claude/rules/`：按文件类型/路径范围的精确规则
- `@path` 导入：不复制内容，按需引用

**Viking 当前做法**：

- active_memory_recall / active_memory_save 工具
- L0 时间线作为跨会话记忆
- 但缺乏"组织级"和"路径级"的规则粒度

---

### 精华 7：Hook 系统 — 行为拦截与增强

**Claude Code 做法**：

- Pre-tool / Post-tool hooks：在工具执行前后拦截
- Prompt hooks：修改发给模型的 prompt
- HTTP hooks：远程 webhook 集成
- MCP tool hooks：外部工具行为控制
- 异步 hooks 支持

**Viking 当前做法**：

- Viking 路由本身就是一种 pre-tool hook
- 但缺乏 post-tool 和 prompt hook

---

## 三、Viking × Claude Code 对比矩阵

| 维度         | Claude Code                   | Viking 当前               | Viking 优势        | Viking 劣势         |
| ------------ | ----------------------------- | ------------------------- | ------------------ | ------------------- |
| 工具选择     | Tool Search 按需发现          | 能力包预选                | 更快（无搜索开销） | 预判不准则缺工具    |
| Context 管理 | auto compact + thrashing 检测 | L0/L1/L2 分层             | 更精细的历史分层   | 缺 compact 后重路由 |
| 多模型       | 3 个模型分层                  | 18+ 国产 Provider         | 生态更丰富         | 缺动态模型切换      |
| 记忆         | CLAUDE.md + Auto Memory       | L0 时间线 + active_memory | 时间线索引更优雅   | 缺路径级规则        |
| 并行         | Subagent 并行隔离             | Task Registry 单线程      | —                  | 无法并行路由        |
| Hook         | 7 种 hook 事件                | 仅路由 hook               | —                  | 行为可控性弱        |
| 验证         | 内置 verify 循环              | 无内置验证                | —                  | 容错能力弱          |
| 路由缓存     | 无显式缓存                    | LRU + 5min TTL            | 减少重复路由       | 缓存失效策略简单    |

---

## 四、下一步优化建议（6 项，按优先级排序）

### 🔴 P0：工具动态再路由 — 让 Viking 像 Tool Search 一样灵活

**问题**：当前 Viking 在 turn 1 路由后工具就固定了，如果模型发现需要未加载的工具，只能降级。

**方案**：

```typescript
// viking-router.ts 新增：动态工具补充
export async function vikingReRoute(params: {
  currentTools: Set<string>; // 当前已加载的工具
  newRequest: string; // 用户新请求/工具调用失败信息
  allTools: AgentToolLike[]; // 全量工具列表
  model: Model<Api>;
  modelRegistry: ModelRegistry;
  provider: string;
}): Promise<{ addTools: Set<string>; removeTools: Set<string> }> {
  // 仅对新请求做轻量判断：
  // 1. 如果新请求不需要额外工具 → 返回空集
  // 2. 如果需要新工具 → 返回 addTools
  // 3. 如果之前的工具明显不需要 → 返回 removeTools

  const system = `你是一个工具补充路由器。
当前已加载工具: [${[...params.currentTools].join(", ")}]
全量工具: [${params.allTools.map((t) => t.name).join(", ")}]
用户新请求: "${params.newRequest}"

判断是否需要补充新工具。回复 JSON:
{"addTools":["tool1","tool2"],"removeTools":["tool3"]}`;

  const result = await callRoutingModel({
    model: params.model,
    modelRegistry: params.modelRegistry,
    provider: params.provider,
    system,
    user: params.newRequest,
  });

  return result ?? { addTools: new Set(), removeTools: new Set() };
}
```

**触点**：在 `attempt.ts` 的工具调用失败回调中触发 `vikingReRoute`。

**预期收益**：解决"一次性预判不准"的核心痛点，接近 Tool Search 的灵活性，但保留 Viking 的速度优势。

---

### 🟡 P1：Compact 后重路由 — Context 管理闭环

**问题**：auto-compact 清理旧工具输出后，之前路由加载的工具可能不再需要，需要重新评估。

**方案**：

```typescript
// 在 attempt.ts 的 compact 回调中添加
onCompact: async (compactedContext: CompactedContext) => {
  if (!VIKING_ENABLED) return;

  // 1. 从 compactedContext 中提取当前对话意图
  const currentIntent = compactedContext.summary;

  // 2. 用 vikingReRoute 重新评估需要的工具
  const reRoute = await vikingReRoute({
    currentTools: activeTools,
    newRequest: currentIntent,
    allTools: toolsRaw,
    model,
    modelRegistry,
    provider,
  });

  // 3. 动态调整工具集
  for (const t of reRoute.addTools) {
    if (!activeTools.has(t)) activeTools.add(t);
  }
  for (const t of reRoute.removeTools) {
    activeTools.delete(t);
  }

  log.info(
    `[viking] post-compact re-route: +[${[...reRoute.addTools]}] -[${[...reRoute.removeTools]}]`,
  );
};
```

**预期收益**：与 Claude Code 的 compact + tool search 闭环等价，但成本更低（增量路由 vs 全量搜索）。

---

### 🟡 P2：路由模型动态切换 — 精准投放算力

**问题**：当前路由模型是全局配置，简单的"你好"和复杂的"重构整个认证模块"用同一个路由模型浪费成本。

**方案**：

```typescript
// viking-router.ts 修改：按任务复杂度选路由模型
function selectRoutingModel(
  prompt: string,
  timeline?: string,
): {
  model: string;
  provider: string;
  maxTokens: number;
} {
  // 快速启发式判断任务复杂度
  const complexIndicators = /重构|架构|迁移|安全|优化|分析|对比|设计|review/i;
  const simpleIndicators = /^(你好|hi|hello|谢谢|好的|是|否|ok|yes|no)[!！。.]*$/i;

  if (simpleIndicators.test(prompt.trim())) {
    // 简单问候 → 最便宜的模型
    return { model: "qwen2.5-3b-instruct", provider: "dashscope", maxTokens: 50 };
  }

  if (complexIndicators.test(prompt) || (timeline && timeline.length > 2000)) {
    // 复杂任务 → 更强的模型
    return { model: "qwen-max", provider: "dashscope", maxTokens: 300 };
  }

  // 默认 → 平衡模型
  return { model: "qwen-plus", provider: "dashscope", maxTokens: 200 };
}
```

**预期收益**：简单任务路由成本降低 80%+，复杂任务路由质量提升。

---

### 🟢 P3：并行路由能力 — Viking × Subagent

**问题**：当用户请求涉及多个独立子任务时（如"搜索 A 网站政策并对比 B 文档"），当前是串行处理。

**方案**：

```typescript
// viking-task-registry.ts 扩展：并行路由编排
export async function vikingParallelRoute(params: {
  tasks: Array<{
    id: string;
    prompt: string;
  }>;
  tools: AgentToolLike[];
  model: Model<Api>;
  modelRegistry: ModelRegistry;
  provider: string;
}): Promise<Map<string, VikingRouteResult>> {
  // 为每个子任务独立路由
  const results = new Map<string, VikingRouteResult>();

  const promises = params.tasks.map(async (task) => {
    const result = await vikingRoute({
      prompt: task.prompt,
      tools: params.tools,
      fileNames: [], // 子任务无文件依赖
      skills: [], // 子任务无 skills
      model: params.model,
      modelRegistry: params.modelRegistry,
      provider: params.provider,
    });
    results.set(task.id, result);
  });

  await Promise.all(promises);
  return results;
}
```

**长期演进**：结合 OpenClaw 的 subagent 系统，实现"路由 → 分发 → 并行执行 → 合并结果"的完整流程。

---

### 🟢 P4：路径级规则引擎 — 借鉴 Claude Code 的 .claude/rules/

**问题**：Viking 的路由规则是硬编码的能力包映射，无法按项目/文件类型差异化。

**方案**：

```yaml
# .viking/rules/typescript.yaml — 路由规则文件
when:
  filePatterns: ["*.ts", "*.tsx"]
then:
  packs: ["code", "search", "infra"]
  skills: ["github", "coding-agent"]
  promptMode: "L1"

# .viking/rules/simple-chat.yaml
when:
  promptLength: "<50"
  noFileContext: true
then:
  packs: []  # 只用 core (read + exec)
  promptMode: "L0"
```

```typescript
// viking-router.ts 新增：规则引擎
interface VikingRule {
  when: { filePatterns?: string[]; promptLength?: string; noFileContext?: boolean };
  then: { packs: string[]; skills: string[]; promptMode: PromptMode };
}

function matchRules(rules: VikingRule[], context: RoutingContext): VikingRule | null {
  for (const rule of rules) {
    if (matchesCondition(rule.when, context)) return rule;
  }
  return null;
}

// 在 vikingRoute 入口处增加规则匹配
const matchedRule = matchRules(loadedRules, { fileNames, promptLength, hasFileContext });
if (matchedRule) {
  // 直接用规则结果，跳过路由模型调用
  return expandRuleToResult(matchedRule);
}
```

**预期收益**：

- 常见模式零成本路由（不需要调用路由模型）
- 项目可自定义路由策略
- 减少路由模型 90% 的调用次数

---

### 🟢 P5：验证反馈回路 — Viking 版 verify loop

**问题**：路由失败后缺乏自动纠正机制。

**方案**：

```typescript
// viking-router.ts 新增：路由验证与自纠正
interface VikingRouteFeedback {
  routeResult: VikingRouteResult;
  executionResult: "success" | "tool_missing" | "tool_error" | "context_overflow";
  missingToolName?: string;
  errorMessage?: string;
}

export async function vikingRouteWithFeedback(params: {
  feedback: VikingRouteFeedback;
  originalPrompt: string;
  allTools: AgentToolLike[];
  model: Model<Api>;
  modelRegistry: ModelRegistry;
  provider: string;
}): Promise<VikingRouteResult | null> {
  if (params.feedback.executionResult === "tool_missing" && params.feedback.missingToolName) {
    // 工具缺失 → 补充该工具及其相关能力包
    const tool = params.allTools.find((t) => t.name === params.feedback.missingToolName);
    if (!tool) return null;

    const packForTool = reverseLookupPack(tool.name);
    log.info(`[viking] feedback: adding pack ${packForTool} for missing tool ${tool.name}`);

    return {
      tools: new Set([...params.feedback.routeResult.tools, tool.name]),
      files: params.feedback.routeResult.files,
      promptLayer: "L1",
      skillsMode: "names",
      skipped: false,
      needsL1: false,
      l1Dates: [],
      needsL2: false,
    };
  }

  if (params.feedback.executionResult === "context_overflow") {
    // Context 溢出 → 降级到 L0
    return {
      ...params.feedback.routeResult,
      promptLayer: "L0",
      skillsMode: "names",
    };
  }

  return null;
}
```

**触点**：在 `attempt.ts` 的工具调用异常处理中调用 `vikingRouteWithFeedback`。

---

## 五、实施路线图

| 阶段       | 时间   | 内容                                        | 依赖            |
| ---------- | ------ | ------------------------------------------- | --------------- |
| **阶段 0** | 本周   | 先提交当前修改，完成 MERGE_PLAN 的 Step 1-3 | 无              |
| **阶段 1** | 1-2 周 | P0 动态再路由 + P2 路由模型动态切换         | MERGE_PLAN 完成 |
| **阶段 2** | 2-3 周 | P1 Compact 后重路由 + P5 验证反馈回路       | 阶段 1          |
| **阶段 3** | 3-4 周 | P4 路径级规则引擎                           | 阶段 1          |
| **阶段 4** | 4-6 周 | P3 并行路由能力 + Viking 模块独立化         | 阶段 2-3        |

---

## 六、Viking 的独特优势（Claude Code 不具备）

1. **国产 Provider 生态**：18+ 个国产模型，Claude Code 只有自家 3 个
2. **L0/L1/L2 精细分层**：Claude Code 只有 full/compact，Viking 有三层渐进式 context
3. **时间线索引**：将历史对话编码为时间线 ID，既是索引又是上下文锚点
4. **18 种能力包分类**：比 Claude Code 的 5 类工具分类更细致
5. **成本可控**：路由模型可选 3B 级别，Claude Code 所有路由必须经过自家 API
6. **SearXNG 集成**：自托管搜索，不依赖任何云 API

---

_方案版本: v1.0 | 日期: 2026-04-12 | 基于 Claude Code 官方文档 2026.4 分析_
