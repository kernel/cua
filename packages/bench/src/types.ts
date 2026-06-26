import type { CuaModelRef } from "@onkernel/cua-ai";

/** A single benchmark task: a natural-language instruction with an optional start URL. */
export interface BenchTask {
	id: string;
	instruction: string;
	startUrl?: string;
	metadata?: Record<string, unknown>;
}

/** One step of an agent run, capturing the action and the screenshot it produced. */
export interface TrajectoryStep {
	index: number;
	action: string;
	screenshotBase64?: string;
	screenshotMimeType?: string;
}

/** The full agent run for a task: ordered steps plus the final assistant answer. */
export interface Trajectory {
	steps: TrajectoryStep[];
	finalAnswer: string;
}

/** Outcome of grading a trajectory against its task. */
export interface GradeResult {
	success: boolean;
	reasoning: string;
	details?: Record<string, unknown>;
}

/** Multimodal content passed to a {@link JudgeModel}. */
export type JudgeContent = Array<
	| { type: "text"; text: string }
	| { type: "image"; data: string; mimeType: string }
>;

/** A model used by a grader. Implemented by a provider call; mocked in tests. */
export interface JudgeModel {
	complete(systemPrompt: string, content: JudgeContent): Promise<string>;
}

export interface LoadTasksOptions {
	limit?: number;
	cacheDir?: string;
	token?: string;
}

export interface GradeArgs {
	task: BenchTask;
	trajectory: Trajectory;
	judge: JudgeModel;
	scoreThreshold: number;
}

/**
 * A pluggable benchmark. Register implementations in the registry to make them
 * runnable by id. Online-Mind2Web is the first implementation; others
 * (WebVoyager, etc.) drop in behind this interface.
 */
export interface Benchmark {
	id: string;
	description: string;
	loadTasks(opts: LoadTasksOptions): Promise<BenchTask[]>;
	buildInstruction(task: BenchTask): string;
	grade(args: GradeArgs): Promise<GradeResult>;
}

export interface RunOptions {
	benchmark: string;
	model: CuaModelRef;
	judgeModel: CuaModelRef;
	limit?: number;
	concurrency?: number;
	scoreThreshold?: number;
	outDir: string;
	cacheDir?: string;
	hfToken?: string;
	kernelApiKey?: string;
	stealth?: boolean;
}

export interface BenchResult {
	taskId: string;
	instruction: string;
	success: boolean;
	reasoning: string;
	finalAnswer: string;
	steps: number;
	error?: string;
	details?: Record<string, unknown>;
}

export interface BenchSummary {
	benchmark: string;
	model: string;
	judgeModel: string;
	total: number;
	succeeded: number;
	failed: number;
	errored: number;
	successRate: number;
	startedAt: string;
	finishedAt: string;
}
