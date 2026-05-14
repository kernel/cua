import { describe, expect, it } from "vitest";
import {
	CUA_ACTION_TYPES,
	CUA_BATCH_TOOL_NAME,
	CUA_NAVIGATION_TOOL_NAME,
	createCuaBatchToolDefinition,
	createCuaNavigationToolDefinition,
	type CuaActionType,
	anthropic,
	gemini,
	openai,
	tzafon,
	yutori,
} from "../src/index";

const providers = { openai, anthropic, gemini, tzafon };

function batchActionVariants(tool: { parameters: any }): any[] {
	const items = tool.parameters.properties.actions.items;
	return items.anyOf ?? items.oneOf ?? [items];
}

describe("computer tool definitions", () => {
	for (const [provider, namespace] of Object.entries(providers)) {
		it(`returns individual CUA action tools for ${provider}`, () => {
			const tools = namespace.computerTools();
			expect(tools.map((tool) => tool.name)).toEqual([...CUA_ACTION_TYPES]);
		});

		it(`returns narrowed individual tools for ${provider}`, () => {
			const tools = namespace.computerTools({ actions: ["click"] });
			expect(tools.map((tool) => tool.name)).toEqual(["click"]);
			expect(tools[0]!.parameters.properties.type).toBeUndefined();
			expect(tools[0]!.parameters.required).toEqual(["x", "y"]);
		});

		it(`each individual action schema for ${provider} accepts only declared fields`, () => {
			const tools = namespace.computerTools();
			for (const tool of tools) {
				expect(tool.parameters.additionalProperties).toBe(false);
				expect(tool.parameters.properties.type).toBeUndefined();
			}
		});
	}

	it("synthesizes a batch tool from an action subset", () => {
		const subset: CuaActionType[] = ["screenshot", "type", "click"];
		const tool = createCuaBatchToolDefinition(subset);
		expect(tool.name).toBe(CUA_BATCH_TOOL_NAME);
		expect(batchActionVariants(tool).map((v) => v.properties.type.const)).toEqual(subset);
	});

	it("emits a single-variant batch schema when narrowed to one action", () => {
		const tool = createCuaBatchToolDefinition(["click"]);
		const items = tool.parameters.properties.actions.items;
		expect(items.anyOf).toBeUndefined();
		expect(items.oneOf).toBeUndefined();
		expect(items.properties.type.const).toBe("click");
	});

	it("synthesizes the navigation helper separately", () => {
		const tool = createCuaNavigationToolDefinition();
		expect(tool.name).toBe(CUA_NAVIGATION_TOOL_NAME);
	});

	it("exposes local canonical executor definitions for Yutori", () => {
		const tools = yutori.computerTools();
		expect(tools.map((tool) => tool.name)).toEqual([...yutori.YUTORI_CANONICAL_ACTION_TYPES]);
		expect(tools.map((tool) => tool.name)).not.toContain(CUA_BATCH_TOOL_NAME);
		expect(tools.map((tool) => tool.name)).not.toContain(CUA_NAVIGATION_TOOL_NAME);
	});

	it("exports Yutori native action sets by model family", () => {
		expect(yutori.yutoriNativeActionsForModel("n1-latest")).toEqual(yutori.YUTORI_N1_ACTION_TYPES);
		expect(yutori.yutoriNativeActionsForModel("n1.5-latest")).toEqual(yutori.YUTORI_N15_CORE_ACTION_TYPES);
		expect(yutori.YUTORI_N15_ACTION_TYPES).toEqual([
			...yutori.YUTORI_N15_CORE_ACTION_TYPES,
			...yutori.YUTORI_N15_EXPANDED_ACTION_TYPES,
		]);
	});

	it("exports provider coordinate systems", () => {
		expect(openai.COMPUTER_TOOL_COORDINATES).toEqual({ type: "pixel" });
		expect(anthropic.COMPUTER_TOOL_COORDINATES).toEqual({ type: "pixel" });
		expect(gemini.COMPUTER_TOOL_COORDINATES).toEqual({ type: "normalized", range: [0, 999] });
		expect(yutori.COMPUTER_TOOL_COORDINATES).toEqual({ type: "normalized", range: [0, 1000] });
		expect(tzafon.COMPUTER_TOOL_COORDINATES).toEqual({ type: "normalized", range: [0, 999] });
	});
});
