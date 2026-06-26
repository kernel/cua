import { onlineMind2Web } from "./benchmarks/online-mind2web/index";
import type { Benchmark } from "./types";

const REGISTRY = new Map<string, Benchmark>([[onlineMind2Web.id, onlineMind2Web]]);

/** Benchmarks scoped for future PRs; not yet implemented. */
export const PLANNED_BENCHMARKS = ["webvoyager", "webarena", "gaia"] as const;

export function getBenchmark(id: string): Benchmark {
	const benchmark = REGISTRY.get(id);
	if (!benchmark) {
		const known = [...REGISTRY.keys()].join(", ");
		throw new Error(
			`unknown benchmark "${id}". available: ${known}. planned: ${PLANNED_BENCHMARKS.join(", ")}`,
		);
	}
	return benchmark;
}

export function listBenchmarks(): string[] {
	return [...REGISTRY.keys()];
}
