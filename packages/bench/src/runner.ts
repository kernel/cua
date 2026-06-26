import { CuaAgentHarness, InMemorySessionRepo, NodeExecutionEnv } from "@onkernel/cua-agent";
import { requireCuaEnvApiKeyForModel } from "@onkernel/cua-ai";
import Kernel from "@onkernel/sdk";
import { piJudgeModel } from "./judge/model";
import { getBenchmark } from "./registry";
import { createTrajectoryCollector, extractFinalAnswer } from "./trajectory";
import { appendResult, writeSummary } from "./output";
import type {
	Benchmark,
	BenchResult,
	BenchSummary,
	BenchTask,
	JudgeModel,
	RunOptions,
	Trajectory,
} from "./types";

/** Drives a single task: runs the agent to produce a trajectory, then tears the browser down. */
export interface TaskRunner {
	run(instruction: string): Promise<Trajectory>;
	teardown(): Promise<void>;
}

export type CreateTaskRunner = (task: BenchTask) => Promise<TaskRunner>;

export interface RunTasksOptions {
	tasks: BenchTask[];
	benchmark: Benchmark;
	judge: JudgeModel;
	scoreThreshold: number;
	concurrency: number;
	outDir: string;
	createTaskRunner: CreateTaskRunner;
}

/**
 * Orchestrates a benchmark: per task creates a {@link TaskRunner}, collects its
 * trajectory, grades it, and writes a JSONL result. Concurrency is bounded by a
 * worker pool over a shared cursor; a task that throws is recorded as a failure
 * without aborting the rest.
 */
export async function runTasks(opts: RunTasksOptions): Promise<BenchResult[]> {
	const resultsFile = `${opts.benchmark.id}.results.jsonl`;
	const results: BenchResult[] = [];
	let cursor = 0;

	const runOne = async (task: BenchTask): Promise<BenchResult> => {
		let runner: TaskRunner | undefined;
		try {
			runner = await opts.createTaskRunner(task);
			const trajectory = await runner.run(opts.benchmark.buildInstruction(task));
			const grade = await opts.benchmark.grade({
				task,
				trajectory,
				judge: opts.judge,
				scoreThreshold: opts.scoreThreshold,
			});
			return {
				taskId: task.id,
				instruction: task.instruction,
				success: grade.success,
				reasoning: grade.reasoning,
				finalAnswer: trajectory.finalAnswer,
				steps: trajectory.steps.length,
				details: grade.details,
			};
		} catch (err) {
			return {
				taskId: task.id,
				instruction: task.instruction,
				success: false,
				reasoning: "",
				finalAnswer: "",
				steps: 0,
				error: err instanceof Error ? err.message : String(err),
			};
		} finally {
			if (runner) await runner.teardown();
		}
	};

	const worker = async (): Promise<void> => {
		while (cursor < opts.tasks.length) {
			const task = opts.tasks[cursor++]!;
			const result = await runOne(task);
			results.push(result);
			await appendResult(opts.outDir, resultsFile, result);
		}
	};

	const workers = Math.min(Math.max(1, opts.concurrency), opts.tasks.length || 1);
	await Promise.all(Array.from({ length: workers }, worker));
	return results;
}

/** Runs a registered benchmark end to end against cua + Kernel cloud browsers. */
export async function runBenchmark(opts: RunOptions): Promise<BenchSummary> {
	const kernelApiKey = opts.kernelApiKey ?? process.env.KERNEL_API_KEY;
	if (!kernelApiKey) throw new Error("KERNEL_API_KEY is required");
	requireCuaEnvApiKeyForModel(opts.model);
	requireCuaEnvApiKeyForModel(opts.judgeModel);

	const benchmark = getBenchmark(opts.benchmark);
	const judge = piJudgeModel(opts.judgeModel);
	const scoreThreshold = opts.scoreThreshold ?? 3;
	const client = new Kernel({ apiKey: kernelApiKey });

	const tasks = await benchmark.loadTasks({
		limit: opts.limit,
		cacheDir: opts.cacheDir,
		token: opts.hfToken,
	});
	const startedAt = new Date().toISOString();

	const createTaskRunner: CreateTaskRunner = async (task) => {
		const browser = await client.browsers.create({ stealth: opts.stealth ?? true });
		const session = await new InMemorySessionRepo().create({ id: task.id });
		const harness = new CuaAgentHarness({
			browser,
			client,
			env: new NodeExecutionEnv({ cwd: process.cwd() }),
			model: opts.model,
			session,
			computerUseExtra: true,
		});
		const { handler, build } = createTrajectoryCollector();
		harness.subscribe(handler);
		return {
			async run(instruction) {
				await harness.prompt(instruction);
				const branch = await session.getBranch();
				return build(extractFinalAnswer(branch));
			},
			async teardown() {
				await client.browsers.deleteByID(browser.session_id).catch(() => {});
			},
		};
	};

	const results = await runTasks({
		tasks,
		benchmark,
		judge,
		scoreThreshold,
		concurrency: Math.max(1, opts.concurrency ?? 1),
		outDir: opts.outDir,
		createTaskRunner,
	});

	const succeeded = results.filter((r) => r.success).length;
	const errored = results.filter((r) => r.error).length;
	const summary: BenchSummary = {
		benchmark: opts.benchmark,
		model: opts.model,
		judgeModel: opts.judgeModel,
		total: results.length,
		succeeded,
		failed: results.length - succeeded,
		errored,
		successRate: results.length ? succeeded / results.length : 0,
		startedAt,
		finishedAt: new Date().toISOString(),
	};
	await writeSummary(opts.outDir, summary);
	return summary;
}
