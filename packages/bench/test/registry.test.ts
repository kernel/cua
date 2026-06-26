import { describe, expect, it } from "vitest";
import { getBenchmark, listBenchmarks, PLANNED_BENCHMARKS } from "../src/registry";

describe("registry", () => {
	it("resolves online-mind2web", () => {
		expect(getBenchmark("online-mind2web").id).toBe("online-mind2web");
	});

	it("lists online-mind2web", () => {
		expect(listBenchmarks()).toContain("online-mind2web");
	});

	it("throws for an unknown benchmark, naming available and planned ones", () => {
		expect(() => getBenchmark("nope")).toThrow(/online-mind2web/);
		expect(() => getBenchmark("nope")).toThrow(/planned/);
	});

	it("scopes planned benchmarks for future PRs", () => {
		expect(PLANNED_BENCHMARKS.length).toBeGreaterThan(0);
	});
});
