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
  VALID_TASK_PRIORITIES,
  VALID_TASK_STATUSES,
} from "../../infra/task-store.js";
import { createSubsystemLogger } from "../../logging/subsystem.js";
import { optionalStringEnum, stringEnum } from "../schema/typebox.js";
import type { AnyAgentTool } from "./common.js";
import { jsonResult, readNumberParam, readStringParam, readStringArrayParam } from "./common.js";

const log = createSubsystemLogger("tasks-tool");

const TASK_ACTIONS = ["list", "create", "update", "show", "remove"] as const;

function isValidStatus(value: string): value is TaskStatus {
  return VALID_TASK_STATUSES.has(value);
}

function isValidPriority(value: string): value is TaskPriority {
  return VALID_TASK_PRIORITIES.has(value);
}

const MAX_LIMIT = 100;

export function createTasksTool(): AnyAgentTool {
  return {
    label: "Tasks",
    name: "tasks",
    description:
      "Manage background tasks: list, create, update, show details, or remove tasks. Use this to track long-running operations, background jobs, or multi-step workflows.",
    parameters: Type.Object({
      action: stringEnum(TASK_ACTIONS, { description: "Action to perform" }),
      taskId: Type.Optional(Type.String({ description: "Task ID (for update/show/remove)" })),
      title: Type.Optional(Type.String({ description: "Task title (for create/update)" })),
      description: Type.Optional(
        Type.String({ description: "Task description (for create/update)" }),
      ),
      status: optionalStringEnum([...VALID_TASK_STATUSES], {
        description: "Task status (for create/update/list filter)",
      }),
      priority: optionalStringEnum([...VALID_TASK_PRIORITIES], {
        description: "Task priority (for create/update/list filter)",
      }),
      tags: Type.Optional(Type.Array(Type.String({ description: "Tags (for create)" }))),
      tag: Type.Optional(Type.String({ description: "Filter by tag (for list)" })),
      error: Type.Optional(
        Type.String({ description: "Error message (for update with failed status)" }),
      ),
      progress: Type.Optional(Type.Number({ description: "Progress 0-100 (for update)" })),
      limit: Type.Optional(Type.Number({ description: "Max results for list (default 20)" })),
    }),
    execute: async (_toolCallId, params) => {
      try {
        const action = readStringParam(params, "action", { required: true });

        switch (action) {
          case "list": {
            cleanupOldTasks().catch((err) => {
              log.warn(
                `[tasks] background cleanup failed: ${err instanceof Error ? err.message : "unknown"}`,
              );
            });
            const statusStr = readStringParam(params, "status");
            const priorityStr = readStringParam(params, "priority");
            const rawLimit = readNumberParam(params, "limit") ?? 20;
            const limit = Math.max(1, Math.min(MAX_LIMIT, rawLimit));
            const tasks = await listTasks({
              status: statusStr && isValidStatus(statusStr) ? statusStr : undefined,
              priority: priorityStr && isValidPriority(priorityStr) ? priorityStr : undefined,
              tag: readStringParam(params, "tag"),
              limit,
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
                  error: `Invalid status: ${status}. Valid: ${[...VALID_TASK_STATUSES].join(", ")}`,
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
                  error: `Invalid priority: ${priority}. Valid: ${[...VALID_TASK_PRIORITIES].join(", ")}`,
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
              if (!Number.isInteger(progress) || progress < 0 || progress > 100) {
                return jsonResult({
                  action: "update",
                  error: `Progress must be an integer 0-100, got: ${progress}`,
                });
              }
              updates.progress = progress;
            }

            if (Object.keys(updates).length === 0) {
              return jsonResult({ action: "update", error: "No update fields provided" });
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
            if (!removed) {
              return jsonResult({ action: "remove", error: `Task not found: ${taskId}` });
            }
            return jsonResult({ action: "remove", success: true, taskId });
          }

          default:
            return jsonResult({
              action,
              error: `Unknown action: ${action}. Use list|create|update|show|remove.`,
            });
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : "unknown error";
        log.warn(`[tasks] execute error: ${msg}`);
        return jsonResult({ error: `Tasks tool error: ${msg.slice(0, 200)}` });
      }
    },
  };
}
