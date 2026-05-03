import { describe, expect, it } from "vitest";
import { CUA_BATCH_TOOL_NAME, CUA_NAVIGATION_TOOL_NAME, anthropic, gemini, openai, tzafon, yutori } from "../src/index.js";

const providers = { openai, anthropic, gemini, tzafon, yutori };

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
	}

	it("narrows the batch action schema when actions are provided", () => {
		const tools = openai.createComputerToolDefinitions({ actions: ["click"] });
		expect(tools.map((tool) => tool.name)).toEqual([CUA_BATCH_TOOL_NAME]);

		const actionsSchema = (tools[0]!.parameters as any).properties.actions.items;
		const variants = actionsSchema.anyOf ?? [actionsSchema];
		expect(variants).toHaveLength(1);
		expect(variants[0].properties.type.const).toBe("click");
		expect(variants[0].properties.x).toBeTruthy();
		expect(variants[0].properties.text).toBeUndefined();
	});

	it("exports provider coordinate systems", () => {
		expect(openai.COMPUTER_TOOL_COORDINATES).toEqual({ type: "pixel" });
		expect(anthropic.COMPUTER_TOOL_COORDINATES).toEqual({ type: "pixel" });
		expect(gemini.COMPUTER_TOOL_COORDINATES).toEqual({ type: "normalized", range: [0, 999] });
		expect(yutori.COMPUTER_TOOL_COORDINATES).toEqual({ type: "normalized", range: [0, 1000] });
		expect(tzafon.COMPUTER_TOOL_COORDINATES).toEqual({ type: "normalized", range: [0, 999] });
	});
});
