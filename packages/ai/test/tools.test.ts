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
} from "../src/index.js";

const providers = { openai, gemini, tzafon };
const ANTHROPIC_BATCH_TOOL_NAME = "computer_batch";

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

	it("exposes Anthropic-supported canonical action tools", () => {
		const tools = anthropic.computerTools();
		expect(tools.map((tool) => tool.name)).toEqual([
			"click",
			"double_click",
			"mouse_down",
			"mouse_up",
			"type",
			"keypress",
			"scroll",
			"move",
			"drag",
			"wait",
			"screenshot",
			"goto",
			"cursor_position",
			ANTHROPIC_BATCH_TOOL_NAME,
		]);
		expect(tools.map((tool) => tool.name)).not.toContain("back");
		expect(tools.map((tool) => tool.name)).not.toContain("forward");
		expect(tools.map((tool) => tool.name)).not.toContain("url");
	});

	it("narrows Anthropic tools to supported actions", () => {
		const tools = anthropic.computerTools({ actions: ["click"], excludeBatch: true });
		expect(tools.map((tool) => tool.name)).toEqual(["click"]);
		expect(tools[0]!.parameters.properties.type).toBeUndefined();
		expect(tools[0]!.parameters.required).toEqual(["x", "y"]);
	});

	it("includes an Anthropic batch tool by default", () => {
		const tool = anthropic.computerTools({ actions: ["click"] }).find((item) => item.name === ANTHROPIC_BATCH_TOOL_NAME);
		expect(tool).toBeDefined();
		expect(batchActionVariants(tool!).map((variant) => variant.properties.type.const)).toEqual(["click"]);
	});

	it("rejects unsupported Anthropic action narrowing", () => {
		expect(() => anthropic.computerTools({ actions: ["url"] })).toThrow("unsupported Anthropic canonical action(s): url");
		expect(() => anthropic.createActionSchema(["url"])).toThrow("unsupported Anthropic canonical action(s): url");
	});

	it("exports provider coordinate systems", () => {
		expect(openai.coordinateSystem()).toEqual({ type: "pixel" });
		expect(anthropic.coordinateSystem()).toEqual({ type: "pixel" });
		expect(gemini.coordinateSystem()).toEqual({ type: "normalized", range: [0, 999] });
		expect(yutori.coordinateSystem()).toEqual({ type: "normalized", range: [0, 1000] });
		expect(tzafon.coordinateSystem()).toEqual({ type: "normalized", range: [0, 999] });
	});
});
