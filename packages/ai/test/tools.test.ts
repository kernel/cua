import { describe, expect, it } from "vitest";
import {
	CUA_ACTION_TYPES,
	CUA_BATCH_TOOL_NAME,
	CUA_NAVIGATION_TOOL_NAME,
	type CuaActionType,
	anthropic,
	gemini,
	openai,
	tzafon,
	yutori,
} from "../src/index";

const providers = { openai, anthropic, gemini, tzafon, yutori };

function batchActionVariants(tool: { parameters: any }): any[] {
	const items = tool.parameters.properties.actions.items;
	return items.anyOf ?? items.oneOf ?? [items];
}

describe("computer tool definitions", () => {
	for (const [provider, namespace] of Object.entries(providers)) {
		it(`returns a default batch tool for ${provider}`, () => {
			const tools = namespace.createComputerToolDefinitions();
			expect(tools.map((tool) => tool.name)).toEqual([CUA_BATCH_TOOL_NAME, CUA_NAVIGATION_TOOL_NAME]);
		});

		it(`returns a narrowed batch tool for ${provider}`, () => {
			const tools = namespace.createComputerToolDefinitions({ actions: ["click"] });
			expect(tools.map((tool) => tool.name)).toEqual([CUA_BATCH_TOOL_NAME]);
		});

		it(`default batch tool for ${provider} covers every CUA action type`, () => {
			const tools = namespace.createComputerToolDefinitions();
			const variants = batchActionVariants(tools[0]!);
			const seen = variants.map((variant) => variant.properties.type.const).sort();
			expect(seen).toEqual([...CUA_ACTION_TYPES].sort());
		});

		it(`each action variant for ${provider} accepts only declared fields`, () => {
			const tools = namespace.createComputerToolDefinitions();
			for (const variant of batchActionVariants(tools[0]!)) {
				expect(variant.additionalProperties).toBe(false);
				expect(variant.required).toContain("type");
			}
		});
	}

	it("narrows the batch action schema when actions are provided", () => {
		const tools = openai.createComputerToolDefinitions({ actions: ["click"] });
		expect(tools.map((tool) => tool.name)).toEqual([CUA_BATCH_TOOL_NAME]);

		const variants = batchActionVariants(tools[0]!);
		expect(variants).toHaveLength(1);
		expect(variants[0].properties.type.const).toBe("click");
		expect(variants[0].properties.x).toBeTruthy();
		expect(variants[0].properties.text).toBeUndefined();
	});

	it("preserves action ordering in narrowed batch schemas", () => {
		const subset: CuaActionType[] = ["screenshot", "type", "click"];
		const tools = openai.createComputerToolDefinitions({ actions: subset });
		const variants = batchActionVariants(tools[0]!);
		expect(variants.map((v) => v.properties.type.const)).toEqual(subset);
	});

	it("emits a single-variant schema (not a union) when narrowed to one action", () => {
		const tools = openai.createComputerToolDefinitions({ actions: ["click"] });
		const items = tools[0]!.parameters.properties.actions.items;
		expect(items.anyOf).toBeUndefined();
		expect(items.oneOf).toBeUndefined();
		expect(items.properties.type.const).toBe("click");
	});

	it("omits computer_use_extra navigation tool when actions are narrowed", () => {
		const tools = openai.createComputerToolDefinitions({ actions: ["click", "goto"] });
		expect(tools).toHaveLength(1);
		expect(tools[0]!.name).toBe(CUA_BATCH_TOOL_NAME);
	});

	it("exposes batch and navigation tool name constants identically across providers", () => {
		for (const namespace of Object.values(providers)) {
			const tools = namespace.createComputerToolDefinitions();
			expect(tools[0]!.name).toBe(CUA_BATCH_TOOL_NAME);
			expect(tools[1]!.name).toBe(CUA_NAVIGATION_TOOL_NAME);
		}
	});

	it("exports provider coordinate systems", () => {
		expect(openai.COMPUTER_TOOL_COORDINATES).toEqual({ type: "pixel" });
		expect(anthropic.COMPUTER_TOOL_COORDINATES).toEqual({ type: "pixel" });
		expect(gemini.COMPUTER_TOOL_COORDINATES).toEqual({ type: "normalized", range: [0, 999] });
		expect(yutori.COMPUTER_TOOL_COORDINATES).toEqual({ type: "normalized", range: [0, 1000] });
		expect(tzafon.COMPUTER_TOOL_COORDINATES).toEqual({ type: "normalized", range: [0, 999] });
	});
});
