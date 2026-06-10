import { describe, expect, it } from "vitest";
import { yutori } from "../src/index.js";

describe("yutoriNativeToolSetOnPayload", () => {
	it("removes local Yutori action tool definitions from payload.tools", () => {
		const payload = {
			tools: [
				{ type: "function", function: { name: "click" } },
				{ type: "function", function: { name: "move" } },
				{ type: "function", function: { name: "batch_computer_actions" } },
				{ type: "function", function: { name: "computer_use_extra" } },
				{ type: "function", function: { name: "custom_tool" } },
			],
		};
		const next = yutori.yutoriNativeToolSetOnPayload(payload) as { tools?: Array<{ function?: { name?: string } }> };
		expect(next.tools?.map((tool) => tool.function?.name)).toEqual([
			"batch_computer_actions",
			"computer_use_extra",
			"custom_tool",
		]);
	});

	it("preserves caller-requested keep tools while adding the n1.5 core tool set", () => {
		const payload = {
			tools: [
				{ type: "function", function: { name: "click" } },
				{ type: "function", function: { name: "batch_computer_actions" } },
			],
		};
		const next = yutori.yutoriNativeToolSetOnPayload(payload, { id: "n1.5-latest" } as never, {
			keepToolNames: ["batch_computer_actions"],
		}) as {
			tool_set?: string;
			disable_tools?: string[];
			tools?: Array<{ function?: { name?: string } }>;
		};
		expect(next.tool_set).toBe(yutori.YUTORI_N15_CORE_TOOL_SET);
		expect(next.disable_tools).toEqual([...yutori.YUTORI_N15_EXPANDED_ACTION_TYPES]);
		expect(next.tools?.map((tool) => tool.function?.name)).toEqual(["batch_computer_actions"]);
	});

	it("returns undefined for non-object payloads", () => {
		expect(yutori.yutoriNativeToolSetOnPayload(undefined)).toBeUndefined();
		expect(yutori.yutoriNativeToolSetOnPayload("x")).toBeUndefined();
	});
});
