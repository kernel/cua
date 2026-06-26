import type { CuaModelRef } from "@onkernel/cua-ai";

/** Token totals summed across every model call in a run. */
export interface TokenTotals {
	input: number;
	output: number;
	total: number;
}

/** A task from the osunlp/Online-Mind2Web dataset. */
export interface Om2wTask {
	task_id: string;
	website: string;
	confirmed_task: string;
	reference_length: number;
}

/** One step of an Online-Mind2Web v2 trajectory. */
export interface ActionStep {
	step: number;
	screenshot: string;
	action: string;
	thought: string | null;
	url: string | null;
}

/** A result.json conforming to the official `online-mind2web-v2` submission schema. */
export interface Om2wResult {
	schema_version: "online-mind2web-v2";
	task: string;
	task_id: string;
	agent_final_answer: string | null;
	reference_length: number;
	action_history: ActionStep[];
}

/** Per-run cost/speed sidecar, kept out of result.json so the latter stays schema-pure. */
export interface TaskMetrics {
	task_id: string;
	model: CuaModelRef;
	wallClockMs: number;
	steps: number;
	tokens: TokenTotals;
	costUsd: number | null;
	stopReason: string;
	errorMessage?: string;
}

/** Aggregated accuracy/cost/speed for one model — the numbers that fill the page. */
export interface ModelSummary {
	model: CuaModelRef;
	tasks: number;
	passed: number | null;
	accuracyPct: number | null;
	avgCostUsd: number | null;
	avgSpeedSec: number;
}
