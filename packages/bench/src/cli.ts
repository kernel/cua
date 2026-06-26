#!/usr/bin/env node
import { parseArgs } from "node:util";
import type { CuaModelRef } from "@onkernel/cua-ai";
import { listBenchmarks } from "./registry";
import { runBenchmark } from "./runner";

const DEFAULT_MODEL = "anthropic:claude-opus-4-7";

async function main(): Promise<void> {
	const { positionals, values } = parseArgs({
		allowPositionals: true,
		options: {
			model: { type: "string" },
			"judge-model": { type: "string" },
			limit: { type: "string" },
			concurrency: { type: "string" },
			"score-threshold": { type: "string" },
			out: { type: "string" },
			"cache-dir": { type: "string" },
		},
	});

	const [command, benchmark] = positionals;
	if (command !== "run" || !benchmark) {
		console.error(
			"usage: cua-bench run <benchmark> --model <ref> --judge-model <ref> [--limit N] [--concurrency K] [--score-threshold N] --out <dir>",
		);
		console.error(`benchmarks: ${listBenchmarks().join(", ")}`);
		process.exit(1);
	}

	const summary = await runBenchmark({
		benchmark,
		model: (values.model ?? DEFAULT_MODEL) as CuaModelRef,
		judgeModel: (values["judge-model"] ?? values.model ?? DEFAULT_MODEL) as CuaModelRef,
		limit: values.limit ? Number(values.limit) : undefined,
		concurrency: values.concurrency ? Number(values.concurrency) : 1,
		scoreThreshold: values["score-threshold"] ? Number(values["score-threshold"]) : 3,
		outDir: values.out ?? `./bench-results/${benchmark}`,
		cacheDir: values["cache-dir"],
	});
	console.log(JSON.stringify(summary, null, 2));
}

void main();
