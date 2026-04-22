import { Type } from "@sinclair/typebox";
import {
  cleanupOldTasks,
  createTask,
  deleteTask,
  getTask,
  listTasks,
  updateTask,
  type TaskPriority,
  type TaskStatus,
} from "../../infra/task-store.js";
import { createSubsystemLogger } from "../../logging/subsystem.js";
import type { AnyAgentTool } from "./common.js";
import { jsonResult, readNumberParam, readStringParam, readStringArrayParam } from "./common.js";

const log = createSubsystemLogger("tasks-tool");

const VALID_STATUSES: readonly TaskStatus[] = [
  "pending",
  "running",
  "completed",
  "failed",
  "cancelled",
];
const VALID_PRIORITIES: readonly TaskPriority[] = ["low", "medium", "high"];

function isValidStatus(value: string): value is TaskStatus {
  return (VALID_STATUSES as readonly string[]).includes(value);
}

function isValidPriority(value: string): value is TaskPriority {
  return (VALID_PRIORITIES as readonly string[]).includes(value);
}

export function createTasksTool(): AnyAgentTool {
  return {
    label: "Tasks",
    name: "tasks",
    description:
      "Manage background tasks: list, create, update, show details, or remove tasks. Use this to track long-running operations, background jobs, or multi-step workflows.",
    parameters: Type.Object({
      action: Type.String({ description: "Action: list|create|update|show|remove" }),
      taskId: Type.Optional(Type.String({ description: "Task ID (for update/show/remove)" })),
      title: Type.Optional(Type.String({ description: "Task title (for create)" })),
      description: Type.Optional(
        Type.String({ description: "Task description (for create/update)" }),
      ),
      status: Type.Optional(
        Type.String({ description: "Task status (for create/update/list filter)" }),
      ),
      priority: Type.Optional(
        Type.String({ description: "Task priority (for create/update/list filter)" }),
      ),
      tags: Type.Optional(Type.Array(Type.String({ description: "Tags (for create)" }))),
      tag: Type.Optional(Type.String({ description: "Filter by tag (for list)" })),
      error: Type.Optional(
        Type.String({ description: "Error message (for update with failed status)" }),
      ),
      progress: Type.Optional(Type.Number({ description: "Progress 0-100 (for update)" })),
      limit: Type.Optional(Type.Number({ description: "Max results for list (default 20)" })),
    }),
    execute: async (_toolCallId, params) => {
      const action = readStringParam(params, "action", { required: true });

      switch (action) {
        case "list": {
          cleanupOldTasks(30 * 24 * 60 * 60 * 1000).catch((err) => {
            log.warn(`[tasks] background cleanup failed: ${String(err)}`);
          });
          const statusStr = readStringParam(params, "status");
          const priorityStr = readStringParam(params, "priority");
          const tasks = await listTasks({
            status: statusStr && isValidStatus(statusStr) ? statusStr : undefined,
            priority: priorityStr && isValidPriority(priorityStr) ? priorityStr : undefined,
            tag: readStringParam(params, "tag"),
            limit: readNumberParam(params, "limit") ?? 20,
          });
          return jsonResult({ action: "list", count: tasks.length, tasks });
        }

        case "create": {
          const title = readStringParam(params, "title", { required: true });
          const priorityStr = readStringParam(params, "priority") ?? "medium";
          const task = await createTask({
            title,
            description: readStringParam(params, "description"),
            priority: isValidPriority(priorityStr) ? priorityStr : "medium",
            tags: readStringArrayParam(params, "tags"),
          });
          return jsonResult({ action: "create", task });
        }

        case "update": {
          const taskId = readStringParam(params, "taskId", { required: true });
          const updates: Parameters<typeof updateTask>[1] = {};
          const status = readStringParam(params, "status");
          if (status) {
            if (isValidStatus(status)) {
              updates.status = status;
            } else {
              return jsonResult({
                action: "update",
                error: `Invalid status: ${status}. Valid: ${VALID_STATUSES.join(", ")}`,
              });
            }
          }
          const priority = readStringParam(params, "priority");
          if (priority) {
            if (isValidPriority(priority)) {
              updates.priority = priority;
            } else {
              return jsonResult({
                action: "update",
                error: `Invalid priority: ${priority}. Valid: ${VALID_PRIORITIES.join(", ")}`,
              });
            }
          }
          const title = readStringParam(params, "title");
          if (title) {
            updates.title = title;
          }
          const desc = readStringParam(params, "description");
          if (desc) {
            updates.description = desc;
          }
          const err = readStringParam(params, "error");
          if (err) {
            updates.error = err;
          }
          const progress = readNumberParam(params, "progress");
          if (progress != null) {
            if (progress < 0 || progress > 100) {
              return jsonResult({
                action: "update",
                error: `Progress must be 0-100, got: ${progress}`,
              });
            }
            updates.progress = progress;
          }

          const updated = await updateTask(taskId, updates);
          if (!updated) {
            return jsonResult({ action: "update", error: `Task not found: ${taskId}` });
          }
          return jsonResult({ action: "update", task: updated });
        }

        case "show": {
          const taskId = readStringParam(params, "taskId", { required: true });
          const task = await getTask(taskId);
          if (!task) {
            return jsonResult({ action: "show", error: `Task not found: ${taskId}` });
          }
          return jsonResult({ action: "show", task });
        }

        case "remove": {
          const taskId = readStringParam(params, "taskId", { required: true });
          const removed = await deleteTask(taskId);
          return jsonResult({ action: "remove", success: removed, taskId });
        }

        default:
          return jsonResult({
            error: `Unknown action: ${action}. Use list|create|update|show|remove.`,
          });
      }
    },
  };
}
