import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ModelSummary, TaskMetrics } from "./types";

/**
 * Roll per-task results into one ModelSummary per model. Cost/speed come from
 * the `metrics.json` sidecars; accuracy comes from an optional WebJudge output
 * (`<model>/webjudge.jsonl`, one `{task_id, predicted_label}` per line) written
 * by `scripts/run-webjudge.sh`. Accuracy is null until that file exists.
 */
export async function aggregate(outDir: string): Promise<ModelSummary[]> {
	const summaries: ModelSummary[] = [];
	const modelDirs = await readdir(outDir, { withFileTypes: true });

	for (const entry of modelDirs) {
		if (!entry.isDirectory()) continue;
		const modelDir = join(outDir, entry.name);
		const metrics = await readMetrics(modelDir);
		if (metrics.length === 0) continue;

		const judged = await readJudgements(join(modelDir, "webjudge.jsonl"));
		const costs = metrics.map((m) => m.costUsd).filter((c): c is number => c !== null);
		const passed = judged ? metrics.filter((m) => judged.get(m.task_id) === true).length : null;

		summaries.push({
			model: metrics[0]!.model,
			tasks: metrics.length,
			passed,
			accuracyPct: judged ? round((passed! / judged.size) * 100, 1) : null,
			avgCostUsd: costs.length ? round(sum(costs) / costs.length, 4) : null,
			avgSpeedSec: round(sum(metrics.map((m) => m.wallClockMs)) / metrics.length / 1000, 1),
		});
	}

	await writeFile(join(outDir, "summary.json"), `${JSON.stringify(summaries, null, 2)}\n`);
	printTable(summaries);
	return summaries;
}

async function readMetrics(modelDir: string): Promise<TaskMetrics[]> {
	const out: TaskMetrics[] = [];
	for (const entry of await readdir(modelDir, { withFileTypes: true })) {
		if (!entry.isDirectory()) continue;
		try {
			out.push(JSON.parse(await readFile(join(modelDir, entry.name, "metrics.json"), "utf8")));
		} catch {
			// task dir without a finished metrics.json — not yet run
		}
	}
	return out;
}

async function readJudgements(path: string): Promise<Map<string, boolean> | undefined> {
	let raw: string;
	try {
		raw = await readFile(path, "utf8");
	} catch {
		return undefined;
	}
	const map = new Map<string, boolean>();
	for (const line of raw.split("\n")) {
		if (!line.trim()) continue;
		const row = JSON.parse(line) as { task_id: string; predicted_label: unknown };
		map.set(row.task_id, isPass(row.predicted_label));
	}
	return map;
}

function isPass(label: unknown): boolean {
	if (typeof label === "number") return label === 1;
	if (typeof label === "boolean") return label;
	if (typeof label === "string") return ["1", "success", "yes", "true"].includes(label.toLowerCase());
	return false;
}

function printTable(summaries: ModelSummary[]): void {
	console.log("\nmodel\taccuracy\tcost/task\tspeed");
	for (const s of summaries) {
		const acc = s.accuracyPct === null ? "—" : `${s.accuracyPct}%`;
		const cost = s.avgCostUsd === null ? "—" : `$${s.avgCostUsd}`;
		console.log(`${s.model}\t${acc}\t${cost}\t${s.avgSpeedSec}s`);
	}
}

function sum(xs: number[]): number {
	return xs.reduce((a, b) => a + b, 0);
}

function round(x: number, places: number): number {
	const f = 10 ** places;
	return Math.round(x * f) / f;
}

if (process.argv[1]?.endsWith("aggregate.ts")) {
	aggregate(process.argv[2] ?? "results").catch((err) => {
		console.error(err);
		process.exit(1);
	});
}
