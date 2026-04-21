# OpenClaw-Viking 2026.4.11

> 基于 OpenClaw 2026.4.11 的 Viking 分层路由优化版，融合 Claude Code 架构精华。  
> 直接 clone 即可使用，不需要再拉 OpenClaw 官方仓库。

---

## 一、核心特性

### 1. Viking 分层路由系统

OpenClaw 原版问题：不管用户说什么，每次请求都全量加载所有工具定义、引导文件、Skill 摘要，固定消耗约 **15,466 tokens**。一句"你好"也要烧这么多。

Viking 的做法：在调用主模型之前，先用轻量路由模型快速判断用户意图，只加载真正需要的工具、文件和技能。

| 场景               | 优化前        | 优化后       | 节省 |
| ------------------ | ------------- | ------------ | ---- |
| 简单对话（"你好"） | 15,466 tokens | 1,021 tokens | 93%  |
| TTS 语音 + 发送    | 15,466 tokens | 1,778 tokens | 88%  |
| 文件操作           | 15,466 tokens | 3,058 tokens | 80%  |
| 代码编写 + 运行    | 15,466 tokens | 5,122 tokens | 67%  |

### 2. P0-P5 动态路由优化（2026.4.11 新增）

融合 Claude Code 架构精华，实现 6 项核心优化：

| 优化项                   | 说明                                                                        |
| ------------------------ | --------------------------------------------------------------------------- |
| **P0: 动态再路由**       | 工具调用失败时自动补充缺失工具，解决"一次性预判不准"的痛点                  |
| **P1: Compact 后重路由** | Context 压缩后重新评估工具集，配合 Thrashing 检测防止无限压缩循环           |
| **P2: 路由模型动态切换** | 按 Prompt 复杂度自动选择路由模型（简单→7B/中等→32B/复杂→72B），精准投放算力 |
| **P3: 并行路由能力**     | 多子任务并行路由，Worker Pool 并发度可配置                                  |
| **P4: 路径级规则引擎**   | YAML 规则配置，常见模式零成本路由（不调用路由模型），减少 90% 路由模型调用  |
| **P5: 验证反馈回路**     | 路由失败自动纠正，工具缺失→补充能力包→Context 溢出→降级 L0                  |

### 3. 新增工具

| 工具                        | 说明                                 |
| --------------------------- | ------------------------------------ |
| `active_memory_recall/save` | 主动记忆召回与保存，跨会话知识积累   |
| `image_generate`            | AI 图片生成（DALL-E 等）             |
| `pdf`                       | PDF 文件文本提取                     |
| `sessions_yield`            | 会话回合让出，支持多 Agent 协作      |
| `tasks`                     | 后台任务管理：创建、列表、更新、删除 |

### 4. 其他增强

- **18+ 国产 Provider 生态**：SiliconFlow、通义千问、Moonshot、DeepSeek、智谱、百川等
- **SearXNG 集成**：自托管隐私搜索引擎，不依赖任何云 API
- **安全加固**：WebSocket 帧大小限制、Exec 策略 CLI、Untrusted Source 标记
- **LLM Idle Window**：从 30s 扩展到 120s，减少不必要的上下文切换
- **Failover 限流冷却**：同 Provider 重试限制 + 指数退避
- **UI 汉化**：默认简体中文界面，系统字体回退（无外部字体依赖）

---

## 二、技术架构

```
用户消息
    │
    ▼
┌──────────────────────────────────────────┐
│  P4: 规则引擎（零成本路由）                │
│  .viking/rules/*.yml → 匹配 → 直接返回    │
│  未匹配 ↓                                 │
├──────────────────────────────────────────┤
│  P2: 复杂度分类 → 选择路由模型             │
│  simple→7B / moderate→32B / complex→72B   │
├──────────────────────────────────────────┤
│  Viking Router                            │
│  • 生成工具索引（9 个能力包）               │
│  • 提取 Skill frontmatter                 │
│  • 路由模型判断用户意图                     │
│  • 输出: 需要的 tools/files/skills         │
├──────────────────────────────────────────┤
│  路由缓存 (LRU + 5min TTL + 精准失效)      │
└──────────────┬───────────────────────────┘
               │
               ▼
┌──────────────────────────────────────────┐
│  attempt.ts 过滤层                        │
│  • toolsRaw.filter(路由结果)               │
│  • contextFiles.filter(路由)               │
│  • L0/L1/L2 分层 Prompt 注入              │
└──────────────┬───────────────────────────┘
               │
               ▼
┌──────────────────────────────────────────┐
│  主模型响应                                │
│  • 只看到需要的工具和文件                   │
│  • Token 消耗大幅降低                      │
└──────────────┬───────────────────────────┘
               │
        ┌──────┴──────┐
        ▼             ▼
┌──────────────┐ ┌────────────────────┐
│ P5: 反馈回路  │ │ P1: Compact 后重路由│
│ 工具缺失→补充 │ │ Thrashing 检测      │
│ Context 溢出  │ │ 60s/3次 → 降级 L0  │
│ →降级 L0     │ │ →重新评估工具集     │
└──────────────┘ └────────────────────┘
```

### 能力包定义

| 包名       | 工具                                              | 说明                              |
| ---------- | ------------------------------------------------- | --------------------------------- |
| `base-ext` | write, edit, apply_patch, grep, find, ls, process | 文件编辑、搜索、进程管理          |
| `web`      | web_search, web_fetch                             | 搜索互联网、抓取网页              |
| `browser`  | browser                                           | 控制浏览器                        |
| `message`  | message                                           | 消息通道（钉钉/Telegram/Discord） |
| `media`    | canvas, image, image_generate, pdf                | 图片分析/生成、画布、PDF          |
| `infra`    | cron, gateway, session_status                     | 定时任务、系统管理                |
| `tasks`    | tasks, active_memory_recall, active_memory_save   | 任务管理、主动记忆                |
| `agents`   | agents*list, sessions*\*, subagents               | 多 Agent 协作                     |
| `nodes`    | nodes                                             | 设备控制                          |

---

## 三、快速启动

### 环境要求

- Node.js >= 18
- pnpm

### 启动步骤

```bash
# 1. clone 本仓库
git clone https://github.com/langkebo/clawx.git
cd clawx

# 2. 安装依赖
pnpm install

# 3. 构建 Web UI（必须在 build 之前执行）
pnpm ui:build

# 4. 构建项目
pnpm build

# 5. 首次配置（选择模型 Provider、通道等）
pnpm openclaw onboard

# 6. 启动服务
pnpm openclaw gateway --verbose    # 前台模式，可看日志
# 或
pnpm openclaw gateway              # 后台模式

# 7. 打开仪表盘
pnpm openclaw dashboard
```

### 常用命令

```bash
pnpm openclaw gateway stop         # 停止服务
pnpm openclaw tui                  # 终端交互模式
pnpm openclaw skills list          # 查看已安装 Skills
pnpm openclaw exec-policy show     # 查看 Exec 安全策略
pnpm openclaw tasks list           # 查看后台任务
pnpm openclaw logs --follow        # 查看日志
```

---

## 四、路由规则配置

在项目根目录创建 `.viking/rules/` 目录，添加 YAML 规则文件：

```yaml
# .viking/rules/typescript.yml
- when:
    filePatterns:
      - "*.ts"
      - "*.tsx"
  then:
    packs:
      - base-ext
      - web
    promptMode: L1

# .viking/rules/simple-chat.yml
- when:
    promptMaxLength: 30
    noFileContext: true
  then:
    packs: []
    promptMode: L0
```

规则匹配优先于路由模型调用，实现零成本路由。

---

## 五、路由模型配置

推荐用本地模型做路由（零成本）：

```bash
# Ollama（最简单）
ollama serve && ollama pull glm4:latest

# 或使用云端模型（SiliconFlow 等）
# 在 openclaw onboard 时选择 Provider 即可
```

P2 动态模型切换会根据 Prompt 复杂度自动选择：

- **简单**（"你好"等）→ Qwen2.5-7B-Instruct
- **中等**（编辑/搜索等）→ Qwen2.5-32B-Instruct
- **复杂**（重构/架构等）→ Qwen2.5-72B-Instruct

---

## 六、钉钉插件（可选）

```bash
pnpm openclaw plugins install https://github.com/adoresever/openclaw-diding.git
```

在 `~/.openclaw/openclaw.json` 中配置钉钉凭证：

```json
{
  "channels": {
    "dingtalk": {
      "enabled": true,
      "clientId": "你的钉钉 AppKey",
      "clientSecret": "你的钉钉 AppSecret",
      "dmPolicy": "open",
      "groupPolicy": "open",
      "requireMention": true
    }
  }
}
```

---

## 七、自定义 Skill 开发

Skill 放在项目的 `skills/` 目录下，每个 Skill 需要一个 `SKILL.md` 文件：

```markdown
---
name: your-skill-name
description: 技能描述，用于路由器判断何时触发此技能。
---

# 技能名称

使用说明...
```

---

## 八、验证优化效果

`--verbose` 模式下发消息，日志会显示：

```
[viking] rule-based route matched: packs=[] mode=L0
[viking] routed: packs=[base-ext,web] tools=[write,edit,grep,find,web_search,web_fetch] layer=L1
[viking] P0 re-route applied: tools=[write,edit,web_search]
[viking] P1 post-compact re-route applied: +[web_search] -[cron]
[viking] prompt complexity: simple (maxTokens=50)
[viking] cache hit for prompt hash abc12345
```

---

## 九、注意事项

1. **构建顺序**：必须先 `pnpm ui:build` 再 `pnpm build`
2. **路由模型建议 7B+**，太小判断不准
3. **敏感信息**：确保不提交 API Key、钉钉密钥等到公开仓库
4. **Skill 脚本路径**：自定义 Skill 中的绝对路径需根据部署环境修改
5. **规则文件**：`.viking/rules/` 已加入 `.gitignore`，不会提交到仓库

---

## 十、相关资源

- **B站**：搜索 **菠萝Ananas**，OpenClaw 系列教程
- **GitHub**：[adoresever/AGI_Ananans](https://github.com/adoresever/AGI_Ananans)
- **钉钉插件**：[adoresever/openclaw-diding](https://github.com/adoresever/openclaw-diding)
- **OpenClaw 官方**：[openclaw/openclaw](https://github.com/openclaw/openclaw)

---

## 许可证

基于 OpenClaw（Apache 2.0 License），Viking 优化部分同样采用 Apache 2.0 协议。
