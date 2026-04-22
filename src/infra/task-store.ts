import { randomBytes } from "node:crypto";
import fsSync from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { resolveStateDir } from "../config/paths.js";
import { createSubsystemLogger } from "../logging/subsystem.js";

const log = createSubsystemLogger("tasks");

export type TaskStatus = "pending" | "running" | "completed" | "failed" | "cancelled";
export type TaskPriority = "low" | "medium" | "high";

export type Task = {
  id: string;
  title: string;
  description?: string;
  status: TaskStatus;
  priority: TaskPriority;
  tags?: string[];
  createdAt: number;
  updatedAt: number;
  startedAt?: number;
  completedAt?: number;
  error?: string;
  progress?: number;
  parentTaskId?: string;
  metadata?: Record<string, unknown>;
};

const TASKS_DIR_NAME = "tasks";

function getTasksDir(): string {
  return path.join(resolveStateDir(), TASKS_DIR_NAME);
}

function getTaskFilePath(taskId: string): string {
  return path.join(getTasksDir(), `${taskId}.json`);
}

function generateTaskId(): string {
  const timestamp = Date.now().toString(36);
  const random = randomBytes(4).toString("hex");
  return `task_${timestamp}_${random}`;
}

function ensureTasksDir(): string {
  const dir = getTasksDir();
  try {
    fsSync.mkdirSync(dir, { recursive: true });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "EEXIST") {
      log.warn(`failed to create tasks dir ${dir}: ${String(err)}`);
    }
  }
  return dir;
}

export async function createTask(params: {
  title: string;
  description?: string;
  priority?: TaskPriority;
  tags?: string[];
  parentTaskId?: string;
  metadata?: Record<string, unknown>;
}): Promise<Task> {
  ensureTasksDir();
  const now = Date.now();
  const task: Task = {
    id: generateTaskId(),
    title: params.title,
    description: params.description,
    status: "pending",
    priority: params.priority ?? "medium",
    tags: params.tags ?? [],
    createdAt: now,
    updatedAt: now,
    parentTaskId: params.parentTaskId,
    metadata: params.metadata,
  };
  await fs.writeFile(getTaskFilePath(task.id), JSON.stringify(task, null, 2), "utf-8");
  log.info(`task created: ${task.id} "${task.title}"`);
  return task;
}

export async function getTask(taskId: string): Promise<Task | null> {
  try {
    const content = await fs.readFile(getTaskFilePath(taskId), "utf-8");
    const parsed = JSON.parse(content);
    if (!parsed || typeof parsed !== "object" || typeof parsed.id !== "string") {
      log.warn(`task file corrupted, skipping: ${taskId}`);
      return null;
    }
    return parsed as Task;
  } catch {
    return null;
  }
}

export async function updateTask(
  taskId: string,
  updates: Partial<
    Pick<
      Task,
      "title" | "description" | "status" | "priority" | "tags" | "error" | "progress" | "metadata"
    >
  >,
): Promise<Task | null> {
  const task = await getTask(taskId);
  if (!task) {
    return null;
  }
  const now = Date.now();
  const updated: Task = {
    ...task,
    ...updates,
    updatedAt: now,
    startedAt: updates.status === "running" && !task.startedAt ? now : task.startedAt,
    completedAt:
      updates.status === "completed" ||
      updates.status === "failed" ||
      updates.status === "cancelled"
        ? now
        : task.completedAt,
  };
  await fs.writeFile(getTaskFilePath(updated.id), JSON.stringify(updated, null, 2), "utf-8");
  log.info(`task updated: ${updated.id} status=${updated.status}`);
  return updated;
}

export async function deleteTask(taskId: string): Promise<boolean> {
  try {
    await fs.unlink(getTaskFilePath(taskId));
    log.info(`task deleted: ${taskId}`);
    return true;
  } catch {
    return false;
  }
}

export async function listTasks(options?: {
  status?: TaskStatus;
  priority?: TaskPriority;
  tag?: string;
  parentTaskId?: string;
  limit?: number;
}): Promise<Task[]> {
  ensureTasksDir();
  const files = await fs.readdir(getTasksDir());
  const tasks: Task[] = [];

  for (const file of files) {
    if (!file.endsWith(".json")) {
      continue;
    }
    try {
      const content = await fs.readFile(path.join(getTasksDir(), file), "utf-8");
      const task = JSON.parse(content) as Task;
      if (!task || typeof task !== "object" || typeof task.id !== "string") {
        continue;
      }
      if (options?.status && task.status !== options.status) {
        continue;
      }
      if (options?.priority && task.priority !== options.priority) {
        continue;
      }
      if (options?.tag && !(task.tags ?? []).includes(options.tag)) {
        continue;
      }
      if (options?.parentTaskId && task.parentTaskId !== options.parentTaskId) {
        continue;
      }
      tasks.push(task);
    } catch {}
  }

  tasks.sort((a, b) => b.updatedAt - a.updatedAt);

  return options?.limit ? tasks.slice(0, options.limit) : tasks;
}

export async function getTaskStats(): Promise<{
  total: number;
  byStatus: Record<TaskStatus, number>;
  byPriority: Record<TaskPriority, number>;
}> {
  const tasks = await listTasks();
  const byStatus: Record<TaskStatus, number> = {
    pending: 0,
    running: 0,
    completed: 0,
    failed: 0,
    cancelled: 0,
  };
  const byPriority: Record<TaskPriority, number> = { low: 0, medium: 0, high: 0 };

  for (const task of tasks) {
    if (task.status in byStatus) {
      byStatus[task.status]++;
    }
    if (task.priority in byPriority) {
      byPriority[task.priority]++;
    }
  }

  return { total: tasks.length, byStatus, byPriority };
}

export async function cleanupCompletedTasks(
  maxAgeMs: number = 7 * 24 * 60 * 60 * 1000,
): Promise<number> {
  const tasks = await listTasks({ status: "completed" });
  const cutoff = Date.now() - maxAgeMs;
  let deleted = 0;
  for (const task of tasks) {
    if (task.completedAt && task.completedAt < cutoff) {
      await deleteTask(task.id);
      deleted++;
    }
  }
  if (deleted > 0) {
    log.info(`cleaned up ${deleted} completed tasks older than ${maxAgeMs}ms`);
  }
  return deleted;
}
