import { Type } from "@sinclair/typebox";
import {
  createTask,
  deleteTask,
  getTask,
  listTasks,
  updateTask,
  type TaskPriority,
  type TaskStatus,
} from "../../infra/task-store.js";
import type { AnyAgentTool } from "./common.js";
import { jsonResult, readNumberParam, readStringParam, readStringArrayParam } from "./common.js";

const TasksListSchema = Type.Object({
  status: Type.Optional(
    Type.String({ description: "Filter by status: pending|running|completed|failed|cancelled" }),
  ),
  priority: Type.Optional(Type.String({ description: "Filter by priority: low|medium|high" })),
  tag: Type.Optional(Type.String({ description: "Filter by tag" })),
  limit: Type.Optional(Type.Number({ description: "Max results (default 20)" })),
});

const TasksCreateSchema = Type.Object({
  title: Type.String({ description: "Task title" }),
  description: Type.Optional(Type.String({ description: "Task description" })),
  priority: Type.Optional(Type.String({ description: "Priority: low|medium|high (default medium)" })),
  tags: Type.Optional(Type.Array(Type.String(), { description: "Tags for categorization" })),
});

const TasksUpdateSchema = Type.Object({
  taskId: Type.String({ description: "Task ID to update" }),
  status: Type.Optional(Type.String({ description: "New status" })),
  priority: Type.Optional(Type.String({ description: "New priority" })),
  title: Type.Optional(Type.String({ description: "New title" })),
  description: Type.Optional(Type.String({ description: "New description" })),
  error: Type.Optional(Type.String({ description: "Error message for failed tasks" })),
  progress: Type.Optional(Type.Number({ description: "Progress percentage 0-100" })),
});

const TasksShowSchema = Type.Object({
  taskId: Type.String({ description: "Task ID to show" }),
});

const TasksRemoveSchema = Type.Object({
  taskId: Type.String({ description: "Task ID to remove" }),
});

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
      description: Type.Optional(Type.String({ description: "Task description (for create/update)" })),
      status: Type.Optional(Type.String({ description: "Task status (for create/update/list filter)" })),
      priority: Type.Optional(Type.String({ description: "Task priority (for create/update/list filter)" })),
      tags: Type.Optional(Type.Array(Type.String({ description: "Tags (for create)" }))),
      error: Type.Optional(Type.String({ description: "Error message (for update with failed status)" })),
      progress: Type.Optional(Type.Number({ description: "Progress 0-100 (for update)" })),
      limit: Type.Optional(Type.Number({ description: "Max results for list (default 20)" })),
    }),
    execute: async (_toolCallId, params) => {
      const action = readStringParam(params, "action", { required: true });

      switch (action) {
        case "list": {
          const tasks = await listTasks({
            status: readStringParam(params, "status") as TaskStatus | undefined,
            priority: readStringParam(params, "priority") as TaskPriority | undefined,
            tag: readStringParam(params, "tag"),
            limit: readNumberParam(params, "limit") ?? 20,
          });
          return jsonResult({ action: "list", count: tasks.length, tasks });
        }

        case "create": {
          const title = readStringParam(params, "title", { required: true });
          const task = await createTask({
            title,
            description: readStringParam(params, "description"),
            priority: (readStringParam(params, "priority") ?? "medium") as TaskPriority,
            tags: readStringArrayParam(params, "tags"),
          });
          return jsonResult({ action: "create", task });
        }

        case "update": {
          const taskId = readStringParam(params, "taskId", { required: true });
          const updates: Parameters<typeof updateTask>[1] = {};
          const status = readStringParam(params, "status");
          if (status) updates.status = status as TaskStatus;
          const priority = readStringParam(params, "priority");
          if (priority) updates.priority = priority as TaskPriority;
          const title = readStringParam(params, "title");
          if (title) updates.title = title;
          const desc = readStringParam(params, "description");
          if (desc) updates.description = desc;
          const err = readStringParam(params, "error");
          if (err) updates.error = err;
          const progress = readNumberParam(params, "progress");
          if (progress != null) updates.progress = progress;

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
          return jsonResult({ error: `Unknown action: ${action}. Use list|create|update|show|remove.` });
      }
    },
  };
}
