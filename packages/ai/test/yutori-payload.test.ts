import { describe, expect, it } from "vitest";
import { yutori } from "../src/index.js";

describe("yutoriBuiltinToolsOnPayload", () => {
	it("removes yutori built-in tool definitions from payload.tools", () => {
		const payload = {
			tools: [
				{ type: "function", function: { name: "click" } },
				{ type: "function", function: { name: "move" } },
				{ type: "function", function: { name: "batch_computer_actions" } },
			],
		};
		const next = yutori.yutoriBuiltinToolsOnPayload(payload) as { tools?: Array<{ function?: { name?: string } }> };
		expect(next.tools).toEqual([{ type: "function", function: { name: "batch_computer_actions" } }]);
	});

	it("returns undefined for non-object payloads", () => {
		expect(yutori.yutoriBuiltinToolsOnPayload(undefined)).toBeUndefined();
		expect(yutori.yutoriBuiltinToolsOnPayload("x")).toBeUndefined();
	});
});
