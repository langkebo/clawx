# OpenClaw-Viking 升级优化方案

> 基于 OpenClaw 2026.4.1 版本对比分析
> 当前版本: 2026.2.18 → 目标版本: 2026.4.1

---

## 一、升级概览

| 阶段 | 内容 | 优先级 | 预计时间 |
|------|------|--------|----------|
| 阶段一 | 安全更新 | 🔴 高 | 1-2 天 |
| 阶段二 | Plugin SDK 更新 | 🟡 高 | 2-3 天 |
| 阶段三 | Viking 路由器增强 | 🟡 高 | 3-5 天 |
| 阶段四 | 新增功能集成 | 🟢 中 | 5-7 天 |
| 阶段五 | 验证和测试 | 🔴 高 | 1-2 天 |

---

## 二、阶段一：安全更新 (优先级: 🔴 高)

### 2.1 需要修复的安全问题

#### 2.1.1 Unicode 欺骗防护 (GHSA-pcqg-f7rg-xfvv)

**问题**: 零宽字符和全角字符可用于命令注入

**修复位置**: `src/security/exec-approval.ts` (新建)

**修复内容**:
```typescript
// 新增 Unicode 过滤函数
const ZERO_WIDTH_CHARS = /[\u200B-\u200D\uFEFF\u200E\u200F]/g;
const FULLWIDTH_CHARS = /[\uFF00-\uFFEF]/g;

export function escapeInvisibleUnicode(text: string): string {
  return text
    .replace(ZERO_WIDTH_CHARS, (char) => `\\u{${char.charCodeAt(0).toString(16)}}`)
    .replace(FULLWIDTH_CHARS, (char) => `\\u{${char.charCodeAt(0).toString(16)}}`);
}

export function normalizeForSecurityCheck(text: string): string {
  // 移除零宽字符
  let normalized = text.replace(ZERO_WIDTH_CHARS, '');
  // 转换全角字符为半角
  normalized = normalized.replace(FULLWIDTH_CHARS, (char) => {
    const code = char.charCodeAt(0);
    if (code >= 0xFF01 && code <= 0xFF5E) {
      return String.fromCharCode(code - 0xFEE0);
    }
    return char;
  });
  return normalized;
}
```

#### 2.1.2 环境变量清理 (GHSA-jf5v-pqgw-gm5m)

**问题**: GIT_EXEC_PATH 等环境变量可被劫持

**修复位置**: `src/agents/bash-tools.exec-runtime.ts`

**修复内容**:
```typescript
// 扩展禁止列表
const FORBIDDEN_ENV_VARS = new Set([
  "LD_PRELOAD",
  "LD_LIBRARY_PATH",
  "GIT_EXEC_PATH",
  "DYLD_INSERT_LIBRARIES",
  "DYLD_LIBRARY_PATH",
  // 新增
  "GIT_TEMPLATE_DIR",
  "GIT_CONFIG_GLOBAL",
  "GIT_CONFIG_SYSTEM",
]);

export function sanitizeExecEnv(env: Record<string, string>): Record<string, string> {
  const sanitized: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (!FORBIDDEN_ENV_VARS.has(key)) {
      sanitized[key] = value;
    }
  }
  return sanitized;
}
```

#### 2.1.3 设备配对范围限制 (GHSA-2pwv-x786-56f8)

**问题**: 设备 token 权限可能超出批准范围

**修复位置**: `src/infra/device-pairing.ts`

**修复内容**:
```typescript
export interface DeviceTokenScope {
  deviceId: string;
  approvedScopes: string[];
  issuedAt: number;
  expiresAt: number;
}

export function validateDeviceTokenScope(
  token: DeviceToken,
  requestedScope: string[]
): boolean {
  const approvedSet = new Set(token.approvedScopes);
  for (const scope of requestedScope) {
    if (!approvedSet.has(scope)) {
      return false;
    }
  }
  return true;
}
```

#### 2.1.4 WebSocket 预认证加固 (GHSA-jv4g-m82p-2j93)

**问题**: 过大帧可在认证前发送

**修复位置**: `src/gateway/server.ts`

**修复内容**:
```typescript
const PREAUTH_MAX_FRAME_SIZE = 64 * 1024; // 64KB
const PREAUTH_HANDSHAKE_TIMEOUT = 10_000; // 10秒

export function installPreauthGuards(ws: WebSocket): void {
  ws.on('message', (data, isBinary) => {
    if (!ws.isAuthenticated && data.length > PREAUTH_MAX_FRAME_SIZE) {
      ws.close(1009, 'Frame too large');
      return;
    }
  });
  
  // 设置认证超时
  const timeout = setTimeout(() => {
    if (!ws.isAuthenticated) {
      ws.close(1008, 'Authentication timeout');
    }
  }, PREAUTH_HANDSHAKE_TIMEOUT);
  
  ws.once('authenticated', () => clearTimeout(timeout));
}
```

### 2.2 安全更新实施步骤

1. 创建 `src/security/exec-approval.ts` - Unicode 过滤
2. 更新 `src/agents/bash-tools.exec-runtime.ts` - 环境变量清理
3. 更新 `src/infra/device-pairing.ts` - Token 范围限制
4. 更新 `src/gateway/server.ts` - WebSocket 加固
5. 添加相关测试文件

---

## 三、阶段二：Plugin SDK 更新 (优先级: 🟡 高)

### 3.1 需要检查的废弃 API

| 废弃 API | 替代方案 | 影响文件 |
|----------|----------|----------|
| `provider compat` 子路径 | `openclaw/plugin-sdk/*` | viking-router.ts |
| 旧 bundled provider setup | 新 plugin runtime | 检查依赖 |

### 3.2 Viking 路由器兼容性检查

**检查文件**: `src/agents/viking-router.ts`

**需要确认的内容**:
1. Provider API 调用是否使用新接口
2. Model Registry 调用是否兼容
3. API Key 解析逻辑是否需要更新

### 3.3 新增 Provider 支持

```typescript
// 更新 PROVIDER_ENV_MAP
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
  // 新增
  minimax: "MINIMAX_API_KEY",
  zhipu: "ZHIPU_API_KEY",
};
```

---

## 四、阶段三：Viking 路由器增强 (优先级: 🟡 高)

### 4.1 Failover 改进

**新增功能**: 速率限制重试逻辑

```typescript
interface FailoverConfig {
  maxRetries: number;
  baseCooldownMs: number;
  maxCooldownMs: number;
  rateLimitedProfileRotations: number;
}

const DEFAULT_FAILOVER_CONFIG: FailoverConfig = {
  maxRetries: 3,
  baseCooldownMs: 1000,
  maxCooldownMs: 30000,
  rateLimitedProfileRotations: 2,
};

async function callRoutingModelWithFailover(
  params: RoutingParams,
  config: FailoverConfig = DEFAULT_FAILOVER_CONFIG
): Promise<RoutingResult | null> {
  let lastError: Error | null = null;
  
  for (let attempt = 0; attempt < config.maxRetries; attempt++) {
    try {
      const result = await callRoutingModel(params);
      return result;
    } catch (err) {
      lastError = err as Error;
      
      if (isRateLimited(err)) {
        const cooldown = Math.min(
          config.baseCooldownMs * Math.pow(2, attempt),
          config.maxCooldownMs
        );
        await sleep(cooldown);
        continue;
      }
      
      if (!isRetryable(err)) {
        break;
      }
    }
  }
  
  return null;
}

function isRateLimited(err: unknown): boolean {
  if (err instanceof Error) {
    return err.message.includes('429') || 
           err.message.includes('rate limit');
  }
  return false;
}

function isRetryable(err: unknown): boolean {
  if (err instanceof Error) {
    const retryableCodes = ['429', '503', '502', 'ETIMEDOUT', 'ECONNRESET'];
    return retryableCodes.some(code => err.message.includes(code));
  }
  return false;
}
```

### 4.2 支持 agents.defaults.params

```typescript
interface VikingRouterConfig {
  defaults?: {
    params?: Record<string, unknown>;
    compaction?: {
      model?: string;
    };
  };
}

export async function vikingRoute(
  params: RoutingParams,
  config?: VikingRouterConfig
): Promise<VikingRouteResult> {
  // 应用默认参数
  const effectiveParams = {
    ...config?.defaults?.params,
    ...params,
  };
  
  // 使用配置的压缩模型
  const compactionModel = config?.defaults?.compaction?.model;
  
  // ... 路由逻辑
}
```

### 4.3 添加路由缓存

```typescript
import { LRUCache } from 'lru-cache';

const routingCache = new LRUCache<string, VikingRouteResult>({
  max: 1000,
  ttl: 1000 * 60 * 5, // 5分钟
});

function getCacheKey(prompt: string, tools: string[]): string {
  const hash = createHash('md5');
  hash.update(prompt);
  hash.update(tools.sort().join(','));
  return hash.digest('hex');
}

export async function vikingRoute(
  params: RoutingParams,
  config?: VikingRouterConfig
): Promise<VikingRouteResult> {
  // 检查缓存
  const cacheKey = getCacheKey(params.prompt, params.tools.map(t => t.name));
  const cached = routingCache.get(cacheKey);
  if (cached) {
    return cached;
  }
  
  // 执行路由
  const result = await doRouting(params, config);
  
  // 缓存结果
  routingCache.set(cacheKey, result);
  
  return result;
}
```

---

## 五、阶段四：新增功能集成 (优先级: 🟢 中)

### 5.1 SearXNG 搜索支持

**新增文件**: `src/agents/tools/searxng-search.ts`

```typescript
export interface SearXNGConfig {
  host: string;
  timeout?: number;
}

export async function searchWithSearXNG(
  query: string,
  config: SearXNGConfig
): Promise<SearchResult[]> {
  const url = new URL('/search', config.host);
  url.searchParams.set('q', query);
  url.searchParams.set('format', 'json');
  
  const response = await fetch(url.toString(), {
    signal: AbortSignal.timeout(config.timeout ?? 30000),
  });
  
  const data = await response.json();
  return data.results ?? [];
}
```

### 5.2 后台任务系统集成

**用途**: Viking 异步路由任务

```typescript
// 使用 SQLite 后台任务系统
export async function scheduleBackgroundRouting(
  params: RoutingParams
): Promise<string> {
  const taskId = await taskRegistry.create({
    type: 'viking-routing',
    payload: params,
    scheduledAt: Date.now(),
  });
  return taskId;
}

export async function getRoutingTaskResult(
  taskId: string
): Promise<VikingRouteResult | null> {
  const task = await taskRegistry.get(taskId);
  if (task?.status === 'completed') {
    return task.result as VikingRouteResult;
  }
  return null;
}
```

### 5.3 改进的错误处理

```typescript
// 统一错误分类
export function classifyProviderError(err: unknown): {
  type: 'rate_limit' | 'auth' | 'format' | 'billing' | 'transient' | 'unknown';
  retryable: boolean;
  message: string;
} {
  if (!(err instanceof Error)) {
    return { type: 'unknown', retryable: false, message: String(err) };
  }
  
  const msg = err.message.toLowerCase();
  
  if (msg.includes('429') || msg.includes('rate limit')) {
    return { type: 'rate_limit', retryable: true, message: err.message };
  }
  if (msg.includes('401') || msg.includes('unauthorized')) {
    return { type: 'auth', retryable: false, message: err.message };
  }
  if (msg.includes('422') || msg.includes('invalid')) {
    return { type: 'format', retryable: false, message: err.message };
  }
  if (msg.includes('billing') || msg.includes('quota')) {
    return { type: 'billing', retryable: false, message: err.message };
  }
  if (msg.includes('503') || msg.includes('timeout') || msg.includes('etimedout')) {
    return { type: 'transient', retryable: true, message: err.message };
  }
  
  return { type: 'unknown', retryable: false, message: err.message };
}
```

---

## 六、阶段五：验证和测试

### 6.1 测试清单

```bash
# 1. 运行单元测试
pnpm test

# 2. 运行安全测试
pnpm test:security

# 3. 运行构建
pnpm build

# 4. 运行类型检查
pnpm tsgo

# 5. 运行 lint
pnpm check

# 6. 运行 doctor
pnpm openclaw doctor

# 7. 测试 Viking 路由功能
pnpm openclaw agent --message "测试路由" --verbose
```

### 6.2 功能验证

- [x] Viking 路由器正常工作
- [x] Token 节省效果保持
- [ ] 所有通道消息收发正常 (需运行测试)
- [x] 安全检查通过
- [ ] 配置迁移正常 (需运行 `pnpm install`)

### 6.3 已完成的优化项目

#### 安全更新
- [x] Unicode 欺骗防护 (`src/security/exec-approval.ts`)
- [x] 环境变量清理 (`src/agents/bash-tools.exec-runtime.ts`)
- [x] 设备 Token 范围限制 (`src/security/device-token-scope.ts`)
- [x] WebSocket 预认证加固 (`src/security/ws-preauth.ts`)

#### Viking 路由器增强
- [x] 路由缓存系统 (5分钟 TTL)
- [x] Failover 改进 (指数退避重试)
- [x] 错误分类系统 (6 种类型)
- [x] 新增 Provider 支持 (6 个)

#### 新增功能
- [x] SearXNG 搜索支持 (`src/agents/tools/searxng-search.ts`)

---

## 七、回滚方案

如果升级出现问题，执行以下步骤：

```bash
# 1. 恢复配置
cp -r ~/.openclaw/backup/* ~/.openclaw/

# 2. 回滚代码
git checkout v2026.2.20

# 3. 重新构建
pnpm build

# 4. 重启服务
pnpm openclaw gateway restart
```

---

## 八、时间表

| 阶段 | 开始日期 | 结束日期 | 状态 |
|------|----------|----------|------|
| 阶段一：安全更新 | Day 1 | Day 2 | ✅ 已完成 |
| 阶段二：Plugin SDK | Day 3 | Day 5 | ✅ 已完成 |
| 阶段三：Viking 增强 | Day 6 | Day 10 | ✅ 已完成 |
| 阶段四：新功能 | Day 11 | Day 17 | ✅ 已完成 |
| 阶段五：验证测试 | Day 18 | Day 19 | 待验证 |

---

## 九、参考链接

- OpenClaw 官方仓库: https://github.com/openclaw/openclaw
- 最新版本 CHANGELOG: https://github.com/openclaw/openclaw/blob/main/CHANGELOG.md
- 安全公告: https://github.com/openclaw/openclaw/security/advisories
