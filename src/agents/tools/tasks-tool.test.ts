import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import * as taskStore from "../../infra/task-store.js";
import { createTasksTool } from "./tasks-tool.js";

vi.mock("../../infra/task-store.js", () => ({
  cleanupOldTasks: vi.fn().mockResolvedValue(0),
  createTask: vi.fn(),
  deleteTask: vi.fn(),
  getTask: vi.fn(),
  listTasks: vi.fn(),
  updateTask: vi.fn(),
  VALID_TASK_STATUSES: new Set(["pending", "running", "completed", "failed", "cancelled"]),
  VALID_TASK_PRIORITIES: new Set(["low", "medium", "high"]),
}));

describe("tasks-tool", () => {
  let tool: ReturnType<typeof createTasksTool>;

  beforeEach(() => {
    tool = createTasksTool();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function execute(params: Record<string, unknown>) {
    return (
      tool as { execute: (id: string, p: Record<string, unknown>) => Promise<unknown> }
    ).execute("test-call-id", params);
  }

  describe("action=list", () => {
    it("lists tasks with default limit", async () => {
      vi.mocked(taskStore.listTasks).mockResolvedValue([]);
      const result = await execute({ action: "list" });
      expect(taskStore.listTasks).toHaveBeenCalledWith({
        status: undefined,
        priority: undefined,
        tag: undefined,
        limit: 20,
      });
      const parsed = JSON.parse((result as { content: Array<{ text: string }> }).content[0].text);
      expect(parsed.action).toBe("list");
      expect(parsed.count).toBe(0);
    });

    it("filters by valid status", async () => {
      vi.mocked(taskStore.listTasks).mockResolvedValue([]);
      await execute({ action: "list", status: "running" });
      expect(taskStore.listTasks).toHaveBeenCalledWith(
        expect.objectContaining({ status: "running" }),
      );
    });

    it("ignores invalid status filter", async () => {
      vi.mocked(taskStore.listTasks).mockResolvedValue([]);
      await execute({ action: "list", status: "invalid_status" });
      expect(taskStore.listTasks).toHaveBeenCalledWith(
        expect.objectContaining({ status: undefined }),
      );
    });

    it("filters by valid priority", async () => {
      vi.mocked(taskStore.listTasks).mockResolvedValue([]);
      await execute({ action: "list", priority: "high" });
      expect(taskStore.listTasks).toHaveBeenCalledWith(
        expect.objectContaining({ priority: "high" }),
      );
    });

    it("filters by tag", async () => {
      vi.mocked(taskStore.listTasks).mockResolvedValue([]);
      await execute({ action: "list", tag: "deploy" });
      expect(taskStore.listTasks).toHaveBeenCalledWith(expect.objectContaining({ tag: "deploy" }));
    });

    it("triggers background cleanup on list", async () => {
      vi.mocked(taskStore.listTasks).mockResolvedValue([]);
      await execute({ action: "list" });
      expect(taskStore.cleanupOldTasks).toHaveBeenCalledWith();
    });
  });

  describe("action=create", () => {
    it("creates a task with defaults", async () => {
      const mockTask = { id: "task_abc", title: "Test", status: "pending", priority: "medium" };
      vi.mocked(taskStore.createTask).mockResolvedValue(mockTask as taskStore.Task);
      const result = await execute({ action: "create", title: "Test" });
      expect(taskStore.createTask).toHaveBeenCalledWith({
        title: "Test",
        description: undefined,
        priority: "medium",
        tags: undefined,
      });
      const parsed = JSON.parse((result as { content: Array<{ text: string }> }).content[0].text);
      expect(parsed.action).toBe("create");
    });

    it("creates a task with custom priority", async () => {
      vi.mocked(taskStore.createTask).mockResolvedValue({} as taskStore.Task);
      await execute({ action: "create", title: "Test", priority: "high" });
      expect(taskStore.createTask).toHaveBeenCalledWith(
        expect.objectContaining({ priority: "high" }),
      );
    });

    it("falls back to medium for invalid priority", async () => {
      vi.mocked(taskStore.createTask).mockResolvedValue({} as taskStore.Task);
      await execute({ action: "create", title: "Test", priority: "urgent" });
      expect(taskStore.createTask).toHaveBeenCalledWith(
        expect.objectContaining({ priority: "medium" }),
      );
    });
  });

  describe("action=update", () => {
    it("updates task status", async () => {
      vi.mocked(taskStore.updateTask).mockResolvedValue({
        id: "t1",
        status: "running",
      } as taskStore.Task);
      const result = await execute({ action: "update", taskId: "t1", status: "running" });
      expect(taskStore.updateTask).toHaveBeenCalledWith("t1", { status: "running" });
      const parsed = JSON.parse((result as { content: Array<{ text: string }> }).content[0].text);
      expect(parsed.action).toBe("update");
    });

    it("rejects invalid status", async () => {
      const result = await execute({ action: "update", taskId: "t1", status: "unknown" });
      const parsed = JSON.parse((result as { content: Array<{ text: string }> }).content[0].text);
      expect(parsed.error).toContain("Invalid status");
    });

    it("rejects invalid priority", async () => {
      const result = await execute({ action: "update", taskId: "t1", priority: "urgent" });
      const parsed = JSON.parse((result as { content: Array<{ text: string }> }).content[0].text);
      expect(parsed.error).toContain("Invalid priority");
    });

    it("rejects progress out of range (negative)", async () => {
      const result = await execute({ action: "update", taskId: "t1", progress: -1 });
      const parsed = JSON.parse((result as { content: Array<{ text: string }> }).content[0].text);
      expect(parsed.error).toContain("Progress must be an integer 0-100");
    });

    it("rejects progress out of range (>100)", async () => {
      const result = await execute({ action: "update", taskId: "t1", progress: 101 });
      const parsed = JSON.parse((result as { content: Array<{ text: string }> }).content[0].text);
      expect(parsed.error).toContain("Progress must be an integer 0-100");
    });

    it("accepts progress at boundary (0)", async () => {
      vi.mocked(taskStore.updateTask).mockResolvedValue({
        id: "t1",
        progress: 0,
      } as taskStore.Task);
      await execute({ action: "update", taskId: "t1", progress: 0 });
      expect(taskStore.updateTask).toHaveBeenCalledWith(
        "t1",
        expect.objectContaining({ progress: 0 }),
      );
    });

    it("accepts progress at boundary (100)", async () => {
      vi.mocked(taskStore.updateTask).mockResolvedValue({
        id: "t1",
        progress: 100,
      } as taskStore.Task);
      await execute({ action: "update", taskId: "t1", progress: 100 });
      expect(taskStore.updateTask).toHaveBeenCalledWith(
        "t1",
        expect.objectContaining({ progress: 100 }),
      );
    });

    it("returns error for missing task", async () => {
      vi.mocked(taskStore.updateTask).mockResolvedValue(null);
      const result = await execute({ action: "update", taskId: "missing", status: "completed" });
      const parsed = JSON.parse((result as { content: Array<{ text: string }> }).content[0].text);
      expect(parsed.error).toContain("Task not found");
    });
  });

  describe("action=show", () => {
    it("shows task details", async () => {
      const mockTask = { id: "t1", title: "Test" };
      vi.mocked(taskStore.getTask).mockResolvedValue(mockTask as taskStore.Task);
      const result = await execute({ action: "show", taskId: "t1" });
      const parsed = JSON.parse((result as { content: Array<{ text: string }> }).content[0].text);
      expect(parsed.action).toBe("show");
    });

    it("returns error for missing task", async () => {
      vi.mocked(taskStore.getTask).mockResolvedValue(null);
      const result = await execute({ action: "show", taskId: "missing" });
      const parsed = JSON.parse((result as { content: Array<{ text: string }> }).content[0].text);
      expect(parsed.error).toContain("Task not found");
    });
  });

  describe("action=remove", () => {
    it("removes a task", async () => {
      vi.mocked(taskStore.deleteTask).mockResolvedValue(true);
      const result = await execute({ action: "remove", taskId: "t1" });
      const parsed = JSON.parse((result as { content: Array<{ text: string }> }).content[0].text);
      expect(parsed.action).toBe("remove");
      expect(parsed.success).toBe(true);
    });
  });

  describe("unknown action", () => {
    it("returns error for unknown action", async () => {
      const result = await execute({ action: "unknown" });
      const parsed = JSON.parse((result as { content: Array<{ text: string }> }).content[0].text);
      expect(parsed.error).toContain("Unknown action");
    });
  });

  describe("taskId validation", () => {
    it("rejects path traversal in show", async () => {
      const result = await execute({ action: "show", taskId: "../../etc/passwd" });
      const parsed = JSON.parse((result as { content: Array<{ text: string }> }).content[0].text);
      expect(parsed.error).toContain("not found");
    });

    it("rejects path traversal in update", async () => {
      const result = await execute({ action: "update", taskId: "../secret", status: "running" });
      const parsed = JSON.parse((result as { content: Array<{ text: string }> }).content[0].text);
      expect(parsed.error).toContain("not found");
    });
  });
});
