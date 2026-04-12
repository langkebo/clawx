# OpenClaw × Viking 完美融合升级方案

> 目标：将官方 openclaw/openclaw 2026.4.11 的全部新功能和安全修复，
> 与本项目的 Viking 分层路由器/历史索引/国产 Provider 等核心创新完美融合，
> 实现零功能损失的升级。

---

## 一、冲突全景分析

### 1.1 需手动合并的高危文件（3 个）

| 文件 | 冲突等级 | 原因 | 策略 |
|------|----------|------|------|
| `src/agents/system-prompt.ts` | 🔴 **极高** | 你加了 L0/L1/L2 PromptMode + isReduced 逻辑；官方也大幅修改了 prompt 内容 | **双向合并**：保留 Viking 的 PromptMode 扩展，同时接入官方新增的 sections |
| `src/agents/pi-embedded-runner/run/attempt.ts` | 🔴 **极高** | 你插入了 Viking 路由调用块（~50行）；官方也改了 attempt 流程 | **精确定位插入点**：在官方新 attempt 逻辑中重现 Viking 集成代码 |
| `src/agents/viking-router.ts` | 🟡 **中** | 你独有文件，不冲突，但需要适配官方新 API | **适配升级**：检查 ModelRegistry/Model 类型签名是否变更 |

### 1.2 低风险文件（安全自动合并）

| 文件 | 情况 |
|------|------|
| `src/agents/viking-task-registry.ts` | 独有文件，零冲突 |
| `src/agents/viking-routervllm.ts` | 独有文件，零冲突 |
| `src/agents/history-index.ts` | 独有文件，零冲突 |
| `src/security/*.ts` | 你已按官方 PR 实现的安全修复，需对比是否与官方一致 |
| `Microsoft/`, `Swabble/`, `openclaw-diding/` | 独有目录，零冲突 |

### 1.3 可删除的冗余文件

| 文件 | 原因 |
|------|------|
| `src/agents/viking-router 兼容opy.ts` | 旧版备份，不再需要 |
| `src/agents/viking-router.ts.bak` | 更早备份 |
| `src/agents/system-prompt.ts.bak` | 备份文件 |
| `src/agents/viking-router c思考兼容opy.ts` | git 记录中的旧版文件名 |

---

## 二、升级执行步骤（共 10 步）

### Step 1：环境准备 — 做好安全网

```bash
# 1. 完整备份当前项目
cd E:\viking\openx
git add -A
git commit -m "chore: pre-merge snapshot"

# 2. 创建升级分支
git checkout -b upgrade/2026.4.11-viking-fusion

# 3. 备份 Viking 核心文件到安全位置
mkdir -p .viking-backup
cp src/agents/viking-router.ts .viking-backup/
cp src/agents/viking-task-registry.ts .viking-backup/
cp src/agents/viking-routervllm.ts .viking-backup/
cp src/agents/history-index.ts .viking-backup/
cp src/agents/system-prompt.ts .viking-backup/
cp src/agents/pi-embedded-runner/run/attempt.ts .viking-backup/
cp UPGRADE_PLAN.md .viking-backup/

# 4. 记录当前 Viking 集成引用点
# （在 attempt.ts 中搜索 "OpenViking" 标记）
grep -n "OpenViking\|vikingRoute\|loadL0Timeline\|loadL1Decisions\|buildSkillNamesOnlyPrompt" \
  src/agents/pi-embedded-runner/run/attempt.ts > .viking-backup/attempt-viking-markers.txt
```

**验证点**：`git status` 显示所有文件已提交，`.viking-backup/` 包含完整备份。

---

### Step 2：添加官方上游并 Fetch

```bash
# 添加官方远程仓库
git remote add upstream https://github.com/openclaw/openclaw.git

# Fetch 最新代码（如果网络不通，用代理或手动下载 tarball）
git fetch upstream main

# 如果 fetch 失败，使用 tarball 方式：
# 1. 从 https://github.com/openclaw/openclaw/archive/refs/heads/main.tar.gz 下载
# 2. 解压到临时目录
# 3. git remote add upstream-tar <临时目录路径>
```

**验证点**：`git log upstream/main --oneline -5` 能看到最新提交。

---

### Step 3：执行 Merge — 预期冲突及处理

```bash
# 合并官方 main，允许冲突
git merge upstream/main --no-commit

# 查看冲突文件
git diff --name-only --diff-filter=U
```

**预期冲突文件**：
1. `src/agents/system-prompt.ts` — **必须手动合并**
2. `src/agents/pi-embedded-runner/run/attempt.ts` — **必须手动合并**
3. `package.json` — 版本号冲突，自动或手动解决
4. 其他可能有少量冲突的文件（取决于官方改了哪些共同文件）

---

### Step 4：合并 system-prompt.ts（最关键步骤）

**原理**：官方版本的 `buildSystemPrompt()` 函数签名和 sections 组装可能已变，但 Viking 的修改集中在：
- 新增 PromptMode 类型 `"L0" | "L1"`
- 新增 `isL0`, `isL1`, `isReduced` 变量
- 在 sections 组装中插入条件跳过逻辑

**操作流程**：

```bash
# 1. 打开冲突文件，定位 3 个 Viking 修改区域

# 区域 A：PromptMode 类型定义（文件顶部）
# 你的版本：
export type PromptMode = "full" | "L1" | "L0" | "minimal" | "none";
# 官方版本可能有新类型，合并为：
export type PromptMode = "full" | "L1" | "L0" | "minimal" | "none";  // 保留 Viking 扩展

# 区域 B：buildSystemPrompt 内变量声明区
# 你的版本新增了：
const isL0 = promptMode === "L0";
const isL1 = promptMode === "L1";
const isReduced = isL0 || isL1;
# 这些变量需要在官方新版本的相同位置插入

# 区域 C：sections 组装中的条件跳过
# 你的版本在多个 section 前加了 isReduced / isL0 判断
# 需要在官方新版本的 sections 中逐个添加
```

**详细合并策略**：

```typescript
// ===== 合并后的 PromptMode 类型 =====
// 保留 Viking 扩展的 L0/L1，同时兼容官方任何新增值
export type PromptMode = "full" | "L1" | "L0" | "minimal" | "none";

// ===== 合并后的变量声明 =====
// 在 buildSystemPrompt() 内，紧跟官方的 promptMode 赋值之后：
const promptMode = params.promptMode ?? "full";
const isMinimal = promptMode === "minimal" || promptMode === "none";
// ↓ Viking 扩展 ↓
const isL0 = promptMode === "L0";
const isL1 = promptMode === "L1";
const isReduced = isL0 || isL1; // L0 或 L1 都跳过 full-only sections
// ↑ Viking 扩展 ↑

// ===== sections 条件跳过逻辑 =====
// 每个官方 section 块前，需要根据 Viking 规则添加条件：
// isReduced → 跳过: CLI Reference, Self-Update, Messaging, Heartbeats,
//             Silent Replies, Model Aliases, Sandbox, Voice, Reply Tags, Reactions
// isL0 → 额外跳过: Tooling, Tool Call Style, Skills, Memory, Docs

// 示例（假设官方有个 messagingSection）：
if (!isReduced) {  // Viking 扩展：L0/L1 都不需要 messaging
  lines.push(...messagingSection);
}
```

**注意**：如果官方在此期间新增了 sections，需逐一评估：
- 如果是"核心对话能力"section（如新增的 embed/reply tags）→ `isReduced` 时跳过
- 如果是"基础 runtime"section → 保留给 L0

---

### Step 5：合并 attempt.ts（第二大关键步骤）

**原理**：Viking 在 attempt.ts 中的集成是一个约 50 行的插入块，位于工具收集完成之后、system prompt 组装之前。

**Viking 代码块的精确定位**：
```
搜索标记: "OpenViking start"
结束标记: "OpenViking end"
L0 标记: "L0 时间线加载"
L1 标记: "L1 按日期按需加载"
```

**操作流程**：

```bash
# 1. 对照 .viking-backup/attempt-viking-markers.txt
#    确认 Viking 的 3 个插入点

# 2. 在官方新版 attempt.ts 中找到相同逻辑位置
#    关键锚点：toolsRaw 收集完成后、contextFiles 组装前

# 3. 重新插入 Viking 代码块
```

**Viking 集成块的完整结构**（需要在官方新版中重现）：

```typescript
// ===== OpenViking start =====
// 实时扫描 skills
const vikingSkillEntries = loadWorkspaceSkillEntries(effectiveWorkspace);
const vikingSkills: Array<{name: string; description: string}> = [];
for (const e of vikingSkillEntries) {
  vikingSkills.push({ name: e.skill.name, description: e.skill.description ?? "" });
}
log.info(`[viking] skills index (${vikingSkills.length}): [${vikingSkills.map(s => s.name).join(", ")}]`);

const vikingFileNames = hookAdjustedBootstrapFiles
  .filter((f) => !f.missing)
  .map((f) => f.name);

// ===== L0 时间线加载（始终） start =====
const l0Result = await loadL0Timeline({ agentDir });
// ===== L0 时间线加载（始终） end =====

const routingDecision = await vikingRoute({
  prompt: params.prompt,
  tools: toolsRaw,
  fileNames: vikingFileNames,
  skills: vikingSkills,
  model: params.model,
  modelRegistry: params.modelRegistry,
  provider: params.provider,
  timeline: l0Result.rawTimeline || undefined,
});

// 应用路由结果
const routedToolsRaw = routingDecision.skipped
  ? toolsRaw
  : toolsRaw.filter((t) => routingDecision.tools.has(t.name));
const routedContextFiles = routingDecision.skipped
  ? contextFiles
  : contextFiles.filter((f) => {
      const fileName = f.path.split("/").pop() ?? f.path;
      return routingDecision.files.has(fileName);
    });
const routedSkillsPrompt =
  routingDecision.skillsMode === "names"
    ? buildSkillNamesOnlyPrompt(vikingSkills)
    : skillsPrompt;
// ===== OpenViking end =====

// ===== L1 按日期按需加载 start =====
let l1Prompt = "";
if (routingDecision.needsL1 && routingDecision.l1Dates && routingDecision.l1Dates.length > 0) {
  const l1Result = await loadL1Decisions({ agentDir, dates: routingDecision.l1Dates });
  if (l1Result.available) {
    l1Prompt = l1Result.prompt;
    log.info(`[viking] L1 loaded for dates [${routingDecision.l1Dates.join(",")}]: ${l1Result.prompt.length} chars`);
  }
} else if (routingDecision.needsL1) {
  // needsL1=true 但无具体日期 → 加载最近的 L1
  // ...你的现有逻辑
}
// ===== L1 按日期按需加载 end =====
```

**关键注意事项**：
- `routedToolsRaw` 需要在后续的 tools 变量赋值处替换 `toolsRaw`
- `routedContextFiles` 需要在 contextFiles 使用处替换
- `routedSkillsPrompt` 需要在 skillsPrompt 使用处替换
- `l1Prompt` 需要追加到 system prompt 的合适位置

---

### Step 6：更新 viking-router.ts — 适配官方新 API

```bash
# 检查官方是否修改了以下类型签名：
# - Model<Api> 类型
# - ModelRegistry 接口
# - getApiKey 方法签名

# 如果有变更，需要更新 viking-router.ts 中的：
# 1. import 类型
# 2. callRoutingModel 函数中的 API 调用方式
# 3. getApiKey 调用方式
```

**具体检查项**：
1. `Model<Api>` 的 `.baseUrl` / `.id` / `.name` 属性是否仍存在
2. `ModelRegistry.getApiKey()` 是否改为异步或签名变更
3. `loadWorkspaceSkillEntries()` 是否在新版中移位或重命名
4. 官方是否新增了 `PromptMode` 值需要路由器感知

---

### Step 7：更新 security 模块 — 确保与官方一致

```bash
# 对比你实现的安全修复与官方版本的差异
# 文件对比：
#   你的: src/security/exec-approval.ts    vs 官方: src/security/exec-approval.ts
#   你的: src/security/device-token-scope.ts vs 官方: src/security/device-token-scope.ts
#   你的: src/security/ws-preauth.ts        vs 官方: (可能在 src/gateway/ 中)

# 如果官方实现更完善，用官方版本
# 如果你的实现更适合 Windows 环境，保留你的版本
```

---

### Step 8：清理冗余文件 + 更新 package.json

```bash
# 1. 删除冗余备份文件
git rm "src/agents/viking-router 兼容opy.ts"
git rm "src/agents/viking-router.ts.bak"  # 如果存在
git rm "src/agents/system-prompt.ts.bak"  # 如果存在
git rm "src/agents/viking-router c思考兼容opy.ts"  # 如果在 git 中

# 2. 更新 package.json 版本号
# 将 version 改为基于官方版本的 Viking 扩展：
# "version": "2026.4.11-viking"  或继续用 "2026.4.11"

# 3. 添加 .gitignore 规则，防止备份文件再次提交
echo ".viking-backup/" >> .gitignore
```

---

### Step 9：构建 + 测试验证

```bash
# 1. 安装依赖（官方新版可能有新依赖）
pnpm install

# 2. TypeScript 类型检查
pnpm tsgo
# 重点检查 viking-router.ts / history-index.ts / attempt.ts 的类型错误

# 3. 构建
pnpm build

# 4. 运行单元测试
pnpm test

# 5. Viking 路由器功能测试
pnpm openclaw agent --message "你好，简单聊天测试" --verbose
# 预期：[viking] routing call 日志，tools=[read,exec]，L0 模式

pnpm openclaw agent --message "帮我编辑 config.json 文件" --verbose
# 预期：[viking] routing，tools 包含 read,exec,write,edit

pnpm openclaw agent --message "搜索最新的 AI 新闻" --verbose
# 预期：[viking] routing 包含 web 包

# 6. 多通道消息测试（Signal/Telegram/Discord）
# 确认消息收发正常

# 7. 新功能验证（来自官方 2026.4.11）
# - Plugin manifest 声明式设置
# - Feishu 文档评论
# - MS Teams 反应
# - Ollama 模型缓存
# - Dreaming/Memory Wiki
```

---

### Step 10：提交 + 清理

```bash
# 1. 确认所有测试通过后提交
git add -A
git commit -m "feat: merge upstream 2026.4.11 with Viking fusion

- Upgraded from 2026.2.18 to 2026.4.11
- Preserved Viking router v4 with layered prompt (L0/L1/L2)
- Preserved Viking history index v5.1
- Preserved Viking task registry + vLLM adapter
- Adapted Viking integration to new attempt.ts flow
- Merged official security fixes (Unicode/env-scope/ws-preauth)
- Adopted official: Plugin manifest, Feishu improvements, MS Teams reactions,
  Ollama cache, Dreaming wiki, video_generate enhancements
- Removed obsolete backup files"

# 2. 合并回 main
git checkout main
git merge upgrade/2026.4.11-viking-fusion

# 3. 清理
git branch -d upgrade/2026.4.11-viking-fusion
rm -rf .viking-backup
```

---

## 三、Viking 核心保留清单

升级后必须保持正常工作的 Viking 功能：

| 功能 | 验证方法 | 优先级 |
|------|----------|--------|
| 分层路由（能力包选择） | `[viking] routing call` 日志 | 🔴 必须 |
| L0 时间线加载 | `[viking] L0` 日志 | 🔴 必须 |
| L1 按日期加载 | 引用之前工作时的 `[viking] L1` 日志 | 🔴 必须 |
| L2 完整对话按需 | 需要详细对话时的按需加载 | 🟡 重要 |
| 路由缓存命中 | `[viking] cache hit` 日志 | 🟡 重要 |
| Failover 重试 | 429/503 时自动重试 | 🟡 重要 |
| Skills 精简模式 | 简单任务只给名称列表 | 🟡 重要 |
| 18 个国产 Provider | dashscope/siliconflow/moonshot/ark 等 | 🔴 必须 |
| SearXNG 搜索 | 替代/supplement web_search | 🟢 可选 |
| vLLM 本地路由 | viking-routervllm.ts | 🟢 可选 |
| Task Registry | 后台异步路由任务 | 🟢 可选 |

---

## 四、回滚方案

如果合并后出现严重问题：

```bash
# 方案 A：回到合并前
git checkout main
git reset --hard <pre-merge-commit-hash>

# 方案 B：使用 Viking 备份还原
cp .viking-backup/viking-router.ts src/agents/
cp .viking-backup/viking-task-registry.ts src/agents/
cp .viking-backup/history-index.ts src/agents/
cp .viking-backup/system-prompt.ts src/agents/
cp .viking-backup/attempt.ts src/agents/pi-embedded-runner/run/
pnpm build

# 方案 C：完全重建
git checkout v2026.2.20  # 或之前的 tag
pnpm install && pnpm build
```

---

## 五、后续持续同步策略

升级完成后，建议建立持续同步机制：

### 5.1 定期 Rebase（推荐每月一次）

```bash
# 每月同步
git fetch upstream main
git rebase upstream/main  # 在 upgrade 分支上
# 处理冲突（通常只有 system-prompt.ts 和 attempt.ts）
pnpm build && pnpm test
git push
```

### 5.2 Viking 模块独立化（长期优化）

将 Viking 模块逐步从核心文件中解耦，减少合并冲突：

1. **viking-prompt-plugin.ts** — 将 system-prompt.ts 中的 Viking 条件逻辑提取为可注入的 plugin
2. **viking-attempt-hook.ts** — 将 attempt.ts 中的 Viking 集成改为 hook 模式（before-run / after-route）
3. **viking-config.ts** — 统一配置，替代硬编码的能力包/Provider 映射

这样未来官方升级时，Viking 代码不再与核心文件交织，合并冲突趋近于零。

---

## 六、时间估算

| 步骤 | 预计时间 | 依赖 |
|------|----------|------|
| Step 1: 环境准备 | 15 分钟 | 无 |
| Step 2: Fetch 上游 | 5-30 分钟 | 网络 |
| Step 3: Merge + 冲突查看 | 10 分钟 | Step 2 |
| Step 4: 合并 system-prompt.ts | **1-2 小时** | Step 3, 需仔细对比 |
| Step 5: 合并 attempt.ts | **1-2 小时** | Step 3, 需仔细对比 |
| Step 6: 更新 viking-router.ts | 30 分钟 | Step 3 |
| Step 7: Security 对比 | 30 分钟 | Step 3 |
| Step 8: 清理 + 版本号 | 15 分钟 | Step 6,7 |
| Step 9: 构建+测试 | 1-2 小时 | Step 8 |
| Step 10: 提交清理 | 15 分钟 | Step 9 |
| **总计** | **4-7 小时** | |

---

## 七、风险矩阵

| 风险 | 概率 | 影响 | 缓解措施 |
|------|------|------|----------|
| system-prompt.ts 合并遗漏 Viking 条件 | 中 | 高 | 逐步测试 L0/L1/L2 三种模式 |
| attempt.ts 官方流程变更导致 Viking 注入点移动 | 高 | 高 | 搜索锚点函数名定位 |
| viking-router.ts 的 Model 类型不兼容 | 低 | 高 | TypeScript 编译即发现 |
| 官方 Plugin SDK 变更影响 Provider 加载 | 中 | 中 | 测试所有国产 Provider |
| 新依赖与 Windows 环境不兼容 | 低 | 中 | pnpm install 检查 |
| SearXNG 工具与官方 web_search 冲突 | 低 | 低 | 两者独立，可共存 |

---

*方案版本: v1.0 | 日期: 2026-04-12 | 基于 upstream 2026.4.11*
