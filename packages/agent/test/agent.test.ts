import { Agent, type AgentTool } from "@earendil-works/pi-agent-core";
import { describe, expect, it } from "vitest";
import { createCuaAgent, createCuaComputerTools, type KernelBrowser } from "../src/index.js";

const browser = { session_id: "browser_123" } as KernelBrowser;

describe("createCuaAgent", () => {
	it("returns a pi-agent-core Agent and resolves model refs in initialState", () => {
		const agent = createCuaAgent({
			browser,
			initialState: {
				model: "openai:gpt-5.5",
			},
		});

		expect(agent).toBeInstanceOf(Agent);
		expect(agent.state.model.id).toBe("gpt-5.5");
		expect(agent.state.tools.length).toBeGreaterThan(0);
	});

	it("uses provided tools exactly", () => {
		const tool: AgentTool<any, any> = {
			name: "custom",
			label: "custom",
			description: "custom tool",
			parameters: { type: "object", properties: {}, additionalProperties: false } as never,
			async execute() {
				return { content: [{ type: "text", text: "ok" }], details: {} };
			},
		};

		const agent = createCuaAgent({
			browser,
			initialState: {
				model: "yutori:n1.5-latest",
				tools: [tool],
			},
		});

		expect(agent.state.tools).toEqual([tool]);
	});

	it("lets users explicitly compose default tools", () => {
		const tools = [
			...createCuaComputerTools({ provider: "openai", browser }),
			{
				name: "custom",
				label: "custom",
				description: "custom tool",
				parameters: { type: "object", properties: {}, additionalProperties: false } as never,
				async execute() {
					return { content: [{ type: "text", text: "ok" }], details: {} };
				},
			} satisfies AgentTool<any, any>,
		];

		const agent = createCuaAgent({
			browser,
			initialState: {
				model: "openai:gpt-5.5",
				tools,
				systemPrompt: "Use the browser carefully.",
			},
		});

		expect(agent.state.tools).toHaveLength(3);
		expect(agent.state.systemPrompt).toBe("Use the browser carefully.");
	});
});
