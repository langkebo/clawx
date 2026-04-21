## OpenClaw-Viking 2026.2.18 - Token优化版

### 🚀 核心更新

#### Viking 分层路由系统

Token 消耗降低 **67%-93%**，实测效果：

| 场景     | 优化前        | 优化后       | 节省    |
| -------- | ------------- | ------------ | ------- |
| 简单对话 | 15,466 tokens | 1,021 tokens | **93%** |
| TTS 语音 | 15,466 tokens | 1,778 tokens | **88%** |
| 文件操作 | 15,466 tokens | 3,058 tokens | **80%** |
| 代码编写 | 15,466 tokens | 5,122 tokens | **67%** |

### ✨ 新增功能

- **路由缓存系统** - 5分钟 TTL，最大 1000 条
- **Failover 改进** - 指数退避重试，速率限制处理
- **错误分类系统** - 6 种错误类型分类
- **SearXNG 搜索集成** - 自托管搜索引擎支持
- **后台任务系统** - SQLite 任务注册表

### 🔒 安全更新

- **Unicode 欺骗防护** - 零宽字符和同形字检测
- **设备 Token 范围验证** - 权限层级扩展
- **WebSocket 预认证加固** - 帧大小限制、速率限制
- **环境变量清理** - 新增 20+ 危险变量禁止

### 📦 Provider 支持

新增 6 个 Provider：

- MiniMax
- 智谱 AI (Zhipu)
- DeepSeek
- Kimi
- 零一万物 (Yi)
- 百川 (Baichuan)

### 🛠️ 类型安全

修复 5 处 `any` 类型：

- `DiscordGuildMember` 接口
- `ToolResult` 接口
- `AgentMessage` 类型
- `TextContentBlock` 接口

### 📦 下载

- **便携版分发包**: `openclaw-viking-2026.2.18-win-x64.zip` (~229 MB)
  - 包含 Node.js 运行时
  - 解压即用，无需安装 Node.js

### 📊 测试状态

- 测试通过率: **99.8%** (7730/7752)
- 失败测试均为环境依赖问题（Windows 限制、外部 API）

---

**完整更新日志**: 查看 [CHANGELOG.md](https://github.com/langkebo/clawx/blob/main/CHANGELOG.md)
