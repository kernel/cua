import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { writeSummary } from "../src/output";
import { runTasks, type TaskRunner } from "../src/runner";
import type { Benchmark, BenchResult, BenchTask, GradeArgs, JudgeModel, Trajectory } from "../src/types";

const judge: JudgeModel = { complete: async () => "" };

function makeBenchmark(grade: (args: GradeArgs) => ReturnType<Benchmark["grade"]>): Benchmark {
	return {
		id: "fake",
		description: "fake",
		loadTasks: async () => [],
		buildInstruction: (task) => task.instruction,
		grade,
	};
}

function fakeTrajectory(finalAnswer: string): Trajectory {
	return { steps: [{ index: 0, action: "goto" }], finalAnswer };
}

describe("runTasks", () => {
	it("runs every task, writes JSONL, and tears down per task", async () => {
		const outDir = await mkdtemp(join(tmpdir(), "cua-bench-"));
		const tornDown: string[] = [];
		const tasks: BenchTask[] = [
			{ id: "a", instruction: "task a" },
			{ id: "b", instruction: "task b" },
		];
		const benchmark = makeBenchmark(async ({ task }) => ({
			success: task.id === "a",
			reasoning: `graded ${task.id}`,
		}));

		const createTaskRunner = async (task: BenchTask): Promise<TaskRunner> => ({
			run: async () => fakeTrajectory(`answer ${task.id}`),
			teardown: async () => {
				tornDown.push(task.id);
			},
		});

		const results = await runTasks({
			tasks,
			benchmark,
			judge,
			scoreThreshold: 3,
			concurrency: 1,
			outDir,
			createTaskRunner,
		});

		expect(results).toHaveLength(2);
		expect(tornDown.sort()).toEqual(["a", "b"]);

		const lines = (await readFile(join(outDir, "fake.results.jsonl"), "utf8"))
			.trim()
			.split("\n")
			.map((l) => JSON.parse(l) as BenchResult);
		expect(lines).toHaveLength(2);
		expect(lines.find((r) => r.taskId === "a")).toMatchObject({ success: true, finalAnswer: "answer a" });
	});

	it("records a thrown task as a failure without aborting the rest", async () => {
		const outDir = await mkdtemp(join(tmpdir(), "cua-bench-"));
		const tornDown: string[] = [];
		const tasks: BenchTask[] = [
			{ id: "boom", instruction: "explode" },
			{ id: "ok", instruction: "fine" },
		];
		const benchmark = makeBenchmark(async () => ({ success: true, reasoning: "ok" }));

		const createTaskRunner = async (task: BenchTask): Promise<TaskRunner> => ({
			run: async () => {
				if (task.id === "boom") throw new Error("kaboom");
				return fakeTrajectory("fine");
			},
			teardown: async () => {
				tornDown.push(task.id);
			},
		});

		const results = await runTasks({
			tasks,
			benchmark,
			judge,
			scoreThreshold: 3,
			concurrency: 1,
			outDir,
			createTaskRunner,
		});

		const boom = results.find((r) => r.taskId === "boom")!;
		expect(boom.success).toBe(false);
		expect(boom.error).toBe("kaboom");
		expect(results.find((r) => r.taskId === "ok")?.success).toBe(true);
		expect(tornDown.sort()).toEqual(["boom", "ok"]);
	});
});

describe("writeSummary", () => {
	it("writes summary.json with the success rate", async () => {
		const outDir = await mkdtemp(join(tmpdir(), "cua-bench-"));
		await writeSummary(outDir, {
			benchmark: "fake",
			model: "anthropic:claude-opus-4-7",
			judgeModel: "anthropic:claude-opus-4-7",
			total: 2,
			succeeded: 1,
			failed: 1,
			errored: 0,
			successRate: 0.5,
			startedAt: "2024-01-01T00:00:00.000Z",
			finishedAt: "2024-01-01T00:01:00.000Z",
		});
		const summary = JSON.parse(await readFile(join(outDir, "summary.json"), "utf8"));
		expect(summary.successRate).toBe(0.5);
		expect(summary.total).toBe(2);
	});
});
