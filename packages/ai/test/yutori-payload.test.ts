import { describe, expect, it } from "vitest";
import { yutori } from "../src/index";

describe("yutoriBuiltinToolsOnPayload", () => {
	it("removes default CUA browser tool definitions from payload.tools", () => {
		const payload = {
			tools: [
				{ type: "function", function: { name: "click" } },
				{ type: "function", function: { name: "move" } },
				{ type: "function", function: { name: "batch_computer_actions" } },
				{ type: "function", function: { name: "computer_use_extra" } },
				{ type: "function", function: { name: "custom_tool" } },
			],
		};
		const next = yutori.yutoriBuiltinToolsOnPayload(payload) as { tools?: Array<{ function?: { name?: string } }> };
		expect(next.tools).toEqual([{ type: "function", function: { name: "custom_tool" } }]);
	});

	it("adds the n1.5 core tool set request fields when model is provided", () => {
		const payload = {
			tools: [{ type: "function", function: { name: "batch_computer_actions" } }],
		};
		const next = yutori.yutoriNativeToolSetOnPayload(payload, { id: "n1.5-latest" } as never) as {
			tool_set?: string;
			disable_tools?: string[];
			tools?: unknown;
		};
		expect(next.tool_set).toBe(yutori.YUTORI_N15_CORE_TOOL_SET);
		expect(next.disable_tools).toEqual([...yutori.YUTORI_N15_EXPANDED_ACTION_TYPES]);
		expect(next.tools).toBeUndefined();
	});

	it("returns undefined for non-object payloads", () => {
		expect(yutori.yutoriBuiltinToolsOnPayload(undefined)).toBeUndefined();
		expect(yutori.yutoriBuiltinToolsOnPayload("x")).toBeUndefined();
	});
});
