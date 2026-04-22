import chalk from "chalk";
import type { Command } from "commander";
import {
  createTask,
  deleteTask,
  getTask,
  getTaskStats,
  listTasks,
  updateTask,
  cleanupOldTasks,
  type Task,
  type TaskStatus,
  type TaskPriority,
} from "../infra/task-store.js";
import { formatHelpExamples } from "./help-format.js";

const STATUS_COLORS: Record<TaskStatus, (s: string) => string> = {
  pending: chalk.yellow,
  running: chalk.blue,
  completed: chalk.green,
  failed: chalk.red,
  cancelled: chalk.gray,
};

const PRIORITY_ICONS: Record<TaskPriority, string> = {
  high: "🔴",
  medium: "🟡",
  low: "🟢",
};

function formatTaskRow(task: Task): string {
  const statusFn = STATUS_COLORS[task.status] ?? chalk.white;
  const priorityIcon = PRIORITY_ICONS[task.priority] ?? "⚪";
  const age = formatAge(task.updatedAt);
  return `${priorityIcon} ${statusFn(task.status.padEnd(10))} ${task.id}  ${task.title}  ${chalk.gray(age)}`;
}

function formatAge(timestampMs: number): string {
  const diffMs = Date.now() - timestampMs;
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) {
    return "just now";
  }
  if (minutes < 60) {
    return `${minutes}m ago`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h ago`;
  }
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function formatTaskDetail(task: Task): string {
  const lines: string[] = [
    chalk.bold(`Task: ${task.title}`),
    `  ID:       ${task.id}`,
    `  Status:   ${STATUS_COLORS[task.status](task.status)}`,
    `  Priority: ${PRIORITY_ICONS[task.priority]} ${task.priority}`,
    `  Created:  ${new Date(task.createdAt).toISOString()}`,
    `  Updated:  ${new Date(task.updatedAt).toISOString()}`,
  ];
  if (task.description) {
    lines.push(`  Description: ${task.description}`);
  }
  if (task.tags?.length) {
    lines.push(`  Tags: ${task.tags.join(", ")}`);
  }
  if (task.startedAt) {
    lines.push(`  Started:  ${new Date(task.startedAt).toISOString()}`);
  }
  if (task.completedAt) {
    lines.push(`  Completed: ${new Date(task.completedAt).toISOString()}`);
  }
  if (task.error) {
    lines.push(`  Error: ${chalk.red(task.error)}`);
  }
  if (task.progress != null) {
    lines.push(`  Progress: ${task.progress}%`);
  }
  if (task.parentTaskId) {
    lines.push(`  Parent: ${task.parentTaskId}`);
  }
  return lines.join("\n");
}

export function registerTasksCli(program: Command) {
  const tasks = program.command("tasks").description("Manage background tasks and job tracking");

  tasks
    .command("list")
    .description("List all tasks (optionally filtered by status, priority, or tag)")
    .option(
      "-s, --status <status>",
      "Filter by status (pending|running|completed|failed|cancelled)",
    )
    .option("-p, --priority <priority>", "Filter by priority (low|medium|high)")
    .option("-t, --tag <tag>", "Filter by tag")
    .option("-l, --limit <number>", "Max tasks to show", "20")
    .option("--json", "Output as JSON")
    .action(async (opts) => {
      const tasks = await listTasks({
        status: opts.status as TaskStatus | undefined,
        priority: opts.priority as TaskPriority | undefined,
        tag: opts.tag,
        limit: parseInt(opts.limit, 10) || 20,
      });
      if (opts.json) {
        console.log(JSON.stringify(tasks, null, 2));
        return;
      }
      if (tasks.length === 0) {
        console.log(chalk.gray("No tasks found."));
        return;
      }
      console.log(chalk.bold(`Tasks (${tasks.length}):\n`));
      for (const task of tasks) {
        console.log(formatTaskRow(task));
      }
    });

  tasks
    .command("show <taskId>")
    .description("Show detailed information about a task")
    .option("--json", "Output as JSON")
    .action(async (taskId: string, opts) => {
      const task = await getTask(taskId);
      if (!task) {
        console.error(chalk.red(`Task not found: ${taskId}`));
        process.exitCode = 1;
        return;
      }
      if (opts.json) {
        console.log(JSON.stringify(task, null, 2));
        return;
      }
      console.log(formatTaskDetail(task));
    });

  tasks
    .command("add <title>")
    .description("Create a new task")
    .option("-d, --description <desc>", "Task description")
    .option("-p, --priority <priority>", "Priority (low|medium|high)", "medium")
    .option("-t, --tags <tags>", "Comma-separated tags")
    .action(async (title: string, opts) => {
      const task = await createTask({
        title,
        description: opts.description,
        priority: (opts.priority as TaskPriority) ?? "medium",
        tags: opts.tags
          ?.split(",")
          .map((t: string) => t.trim())
          .filter(Boolean),
      });
      console.log(chalk.green(`✓ Task created: ${task.id}`));
      console.log(formatTaskRow(task));
    });

  tasks
    .command("update <taskId>")
    .description("Update a task's status, priority, or other fields")
    .option("-s, --status <status>", "New status (pending|running|completed|failed|cancelled)")
    .option("-p, --priority <priority>", "New priority (low|medium|high)")
    .option("--title <title>", "New title")
    .option("--description <desc>", "New description")
    .option("--error <error>", "Error message (for failed tasks)")
    .option("--progress <number>", "Progress percentage (0-100)")
    .action(async (taskId: string, opts) => {
      const updates: Partial<
        Pick<Task, "title" | "description" | "status" | "priority" | "error" | "progress">
      > = {};
      if (opts.status) {
        updates.status = opts.status as TaskStatus;
      }
      if (opts.priority) {
        updates.priority = opts.priority as TaskPriority;
      }
      if (opts.title) {
        updates.title = opts.title;
      }
      if (opts.description) {
        updates.description = opts.description;
      }
      if (opts.error) {
        updates.error = opts.error;
      }
      if (opts.progress != null) {
        updates.progress = parseInt(opts.progress, 10);
      }

      const updated = await updateTask(taskId, updates);
      if (!updated) {
        console.error(chalk.red(`Task not found: ${taskId}`));
        process.exitCode = 1;
        return;
      }
      console.log(chalk.green(`✓ Task updated: ${taskId}`));
      console.log(formatTaskRow(updated));
    });

  tasks
    .command("remove <taskId>")
    .description("Delete a task")
    .action(async (taskId: string) => {
      const removed = await deleteTask(taskId);
      if (!removed) {
        console.error(chalk.red(`Task not found: ${taskId}`));
        process.exitCode = 1;
        return;
      }
      console.log(chalk.green(`✓ Task deleted: ${taskId}`));
    });

  tasks
    .command("stats")
    .description("Show task statistics summary")
    .option("--json", "Output as JSON")
    .action(async (opts) => {
      const stats = await getTaskStats();
      if (opts.json) {
        console.log(JSON.stringify(stats, null, 2));
        return;
      }
      console.log(chalk.bold("Task Statistics:\n"));
      console.log(`  Total: ${stats.total}`);
      console.log(`  ${STATUS_COLORS.pending("Pending")}:   ${stats.byStatus.pending}`);
      console.log(`  ${STATUS_COLORS.running("Running")}:   ${stats.byStatus.running}`);
      console.log(`  ${STATUS_COLORS.completed("Completed")}: ${stats.byStatus.completed}`);
      console.log(`  ${STATUS_COLORS.failed("Failed")}:    ${stats.byStatus.failed}`);
      console.log(`  ${STATUS_COLORS.cancelled("Cancelled")}: ${stats.byStatus.cancelled}`);
    });

  tasks
    .command("cleanup")
    .description("Remove completed tasks older than 7 days")
    .option("--max-age-days <days>", "Maximum age in days", "7")
    .action(async (opts) => {
      const maxAgeDays = parseInt(opts.maxAgeDays, 10) || 7;
      const deleted = await cleanupOldTasks(maxAgeDays * 24 * 60 * 60 * 1000);
      console.log(
        chalk.green(`✓ Cleaned up ${deleted} old task(s) older than ${maxAgeDays} day(s)`),
      );
    });

  tasks.addHelpText(
    "after",
    formatHelpExamples([
      [
        "openclaw tasks add 'Deploy to production' -p high -t deploy,prod",
        "Add a high-priority task",
      ],
      ["openclaw tasks list --status running", "List running tasks"],
      ["openclaw tasks update task_xxx --status completed", "Mark a task as completed"],
      ["openclaw tasks stats", "Show task statistics"],
      ["openclaw tasks cleanup --max-age-days 14", "Clean up old completed tasks"],
    ]),
  );
}
