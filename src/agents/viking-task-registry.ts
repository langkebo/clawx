/**
 * Background Task System for Viking Router
 *
 * Integration with SQLite-backed task registry for async routing operations.
 * Based on OpenClaw 2026.3.31 background tasks system.
 */

export interface VikingRoutingTask {
  id: string;
  type: "viking-routing";
  status: "pending" | "running" | "completed" | "failed" | "blocked";
  payload: RoutingTaskPayload;
  result?: RoutingTaskResult;
  error?: string;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  scheduledAt?: number;
  retryCount: number;
  maxRetries: number;
}

export interface RoutingTaskPayload {
  prompt: string;
  tools: string[];
  fileNames: string[];
  skills: string[];
  timeline?: string;
  provider: string;
  modelId: string;
}

export interface RoutingTaskResult {
  tools: string[];
  files: string[];
  promptLayer: string;
  needsL1: boolean;
  l1Dates: string[];
  needsL2: boolean;
  cached: boolean;
}

export interface TaskRegistryConfig {
  maxConcurrentTasks: number;
  defaultTimeoutMs: number;
  maxRetries: number;
  cleanupIntervalMs: number;
  taskTtlMs: number;
}

const DEFAULT_CONFIG: TaskRegistryConfig = {
  maxConcurrentTasks: 10,
  defaultTimeoutMs: 60_000,
  maxRetries: 3,
  cleanupIntervalMs: 60_000,
  taskTtlMs: 24 * 60 * 60 * 1000, // 24 hours
};

class InMemoryTaskRegistry {
  private tasks: Map<string, VikingRoutingTask> = new Map();
  private config: TaskRegistryConfig;
  private cleanupTimer?: ReturnType<typeof setInterval>;

  constructor(config: Partial<TaskRegistryConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.startCleanupTimer();
  }

  async create(payload: RoutingTaskPayload): Promise<string> {
    const id = `viking-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const task: VikingRoutingTask = {
      id,
      type: "viking-routing",
      status: "pending",
      payload,
      createdAt: Date.now(),
      retryCount: 0,
      maxRetries: this.config.maxRetries,
    };
    this.tasks.set(id, task);
    return id;
  }

  async get(id: string): Promise<VikingRoutingTask | null> {
    return this.tasks.get(id) ?? null;
  }

  async update(id: string, updates: Partial<VikingRoutingTask>): Promise<void> {
    const task = this.tasks.get(id);
    if (task) {
      this.tasks.set(id, { ...task, ...updates });
    }
  }

  async start(id: string): Promise<void> {
    await this.update(id, { status: "running", startedAt: Date.now() });
  }

  async complete(id: string, result: RoutingTaskResult): Promise<void> {
    await this.update(id, {
      status: "completed",
      result,
      completedAt: Date.now(),
    });
  }

  async fail(id: string, error: string): Promise<void> {
    const task = await this.get(id);
    if (!task) return;

    if (task.retryCount < task.maxRetries) {
      await this.update(id, {
        status: "pending",
        error,
        retryCount: task.retryCount + 1,
      });
    } else {
      await this.update(id, {
        status: "failed",
        error,
        completedAt: Date.now(),
      });
    }
  }

  async block(id: string, reason: string): Promise<void> {
    await this.update(id, {
      status: "blocked",
      error: reason,
    });
  }

  async list(filter?: {
    status?: VikingRoutingTask["status"];
    limit?: number;
  }): Promise<VikingRoutingTask[]> {
    let tasks = [...this.tasks.values()];

    if (filter?.status) {
      tasks = tasks.filter((t) => t.status === filter.status);
    }

    tasks.sort((a, b) => b.createdAt - a.createdAt);

    if (filter?.limit) {
      tasks = tasks.slice(0, filter.limit);
    }

    return tasks;
  }

  async delete(id: string): Promise<boolean> {
    return this.tasks.delete(id);
  }

  async getStats(): Promise<{
    total: number;
    pending: number;
    running: number;
    completed: number;
    failed: number;
    blocked: number;
  }> {
    const tasks = [...this.tasks.values()];
    return {
      total: tasks.length,
      pending: tasks.filter((t) => t.status === "pending").length,
      running: tasks.filter((t) => t.status === "running").length,
      completed: tasks.filter((t) => t.status === "completed").length,
      failed: tasks.filter((t) => t.status === "failed").length,
      blocked: tasks.filter((t) => t.status === "blocked").length,
    };
  }

  private startCleanupTimer(): void {
    this.cleanupTimer = setInterval(() => {
      this.cleanup();
    }, this.config.cleanupIntervalMs);
  }

  private cleanup(): void {
    const now = Date.now();
    for (const [id, task] of this.tasks) {
      const age = now - task.createdAt;
      if (age > this.config.taskTtlMs) {
        this.tasks.delete(id);
      }
    }
  }

  stop(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
    }
  }
}

export const taskRegistry = new InMemoryTaskRegistry();

export async function scheduleBackgroundRouting(
  payload: RoutingTaskPayload
): Promise<string> {
  return taskRegistry.create(payload);
}

export async function getRoutingTaskResult(
  taskId: string
): Promise<RoutingTaskResult | null> {
  const task = await taskRegistry.get(taskId);
  if (task?.status === "completed" && task.result) {
    return task.result;
  }
  return null;
}

export async function getRoutingTask(
  taskId: string
): Promise<VikingRoutingTask | null> {
  return taskRegistry.get(taskId);
}

export async function listRoutingTasks(filter?: {
  status?: VikingRoutingTask["status"];
  limit?: number;
}): Promise<VikingRoutingTask[]> {
  return taskRegistry.list(filter);
}

export async function getTaskStats(): Promise<ReturnType<typeof taskRegistry.getStats>> {
  return taskRegistry.getStats();
}
