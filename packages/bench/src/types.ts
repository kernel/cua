import type { CuaModelRef } from "@onkernel/cua-ai";

/** A single benchmark task to run against a model. */
export interface Task {
	id: string;
	prompt: string;
}

/** Token totals summed across every model call in a run. */
export interface TokenTotals {
	input: number;
	output: number;
	total: number;
}

/** Outcome of running one task on one model. */
export interface TaskResult {
	model: CuaModelRef;
	taskId: string;
	/** null until an accuracy judge scores the run. */
	success: boolean | null;
	stopReason: string;
	finalText: string;
	errorMessage?: string;
	wallClockMs: number;
	/** Number of agent turns taken. */
	steps: number;
	tokens: TokenTotals;
	/** null when the provider doesn't report a cost. */
	costUsd: number | null;
}
