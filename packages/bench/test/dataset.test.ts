import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseOnlineMind2WebTasks } from "../src/benchmarks/online-mind2web/dataset";

const fixtureUrl = new URL("./fixtures/online-mind2web.sample.json", import.meta.url);
const fixture = await readFile(fileURLToPath(fixtureUrl), "utf8");

describe("parseOnlineMind2WebTasks", () => {
	it("maps fields and skips malformed rows", () => {
		const tasks = parseOnlineMind2WebTasks(fixture);
		expect(tasks).toHaveLength(2);

		const [t1, t2] = tasks;
		expect(t1).toEqual({
			id: "t1",
			instruction: "Find the cheapest flight from SFO to JFK",
			startUrl: "https://example.com",
			metadata: { referenceLength: 5 },
		});
		expect(t2.id).toBe("t2");
		expect(t2.instruction).toBe("Search the encyclopedia for kernel");
		expect(t2.startUrl).toBeUndefined();
		expect(t2.metadata).toBeUndefined();
	});

	it("falls back to the `task` field when `confirmed_task` is absent", () => {
		const raw = JSON.stringify([{ task_id: "x", task: "do the thing" }]);
		expect(parseOnlineMind2WebTasks(raw)[0].instruction).toBe("do the thing");
	});

	it("applies the limit", () => {
		expect(parseOnlineMind2WebTasks(fixture, 1)).toHaveLength(1);
	});
});
