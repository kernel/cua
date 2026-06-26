import { appendFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { BenchResult, BenchSummary } from "./types";

/** Append one result as a JSONL line under the output dir. */
export async function appendResult(outDir: string, file: string, result: BenchResult): Promise<void> {
	const path = join(outDir, file);
	await mkdir(dirname(path), { recursive: true });
	await appendFile(path, `${JSON.stringify(result)}\n`);
}

/** Write the aggregate summary as summary.json under the output dir. */
export async function writeSummary(outDir: string, summary: BenchSummary): Promise<void> {
	await mkdir(outDir, { recursive: true });
	await writeFile(join(outDir, "summary.json"), JSON.stringify(summary, null, 2));
}
