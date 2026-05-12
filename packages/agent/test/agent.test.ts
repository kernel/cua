import { Agent, type AgentTool } from "@earendil-works/pi-agent-core";
import { describe, expect, it } from "vitest";
import { resolveCuaRuntimeSpec } from "@onkernel/cua-ai";
import type Kernel from "@onkernel/sdk";
import { CuaAgent, CuaHarness, createCuaComputerTools, type KernelBrowser } from "../src/index.js";

const browser = { session_id: "browser_123" } as KernelBrowser;
const client = {} as Kernel;

describe("CuaAgent", () => {
	it("extends pi Agent and resolves model refs in initialState", () => {
		const agent = new CuaAgent({
			browser,
			client,
			initialState: {
				model: "openai:gpt-5.5",
			},
		});

		expect(agent).toBeInstanceOf(Agent);
		expect(agent.state.model.id).toBe("gpt-5.5");
		expect(agent.state.tools.length).toBeGreaterThan(0);
	});

	it("uses provided tools exactly", () => {
		const tool: AgentTool = {
			name: "custom",
			label: "custom",
			description: "custom tool",
			parameters: { type: "object", properties: {}, additionalProperties: false } as never,
			async execute() {
				return { content: [{ type: "text", text: "ok" }], details: {} };
			},
		};

		const agent = new CuaAgent({
			browser,
			client,
			initialState: {
				model: "yutori:n1.5-latest",
				tools: [tool],
			},
		});

		expect(agent.state.tools).toEqual([tool]);
	});

	it("lets users explicitly compose default tools", () => {
		const runtime = resolveCuaRuntimeSpec("openai:gpt-5.5");
		const tools = [
			...createCuaComputerTools({ browser, client, toolDefinitions: runtime.toolDefinitions }),
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

		const agent = new CuaAgent({
			browser,
			client,
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

describe("CuaHarness", () => {
	it("wraps a pi Agent and resolves model refs", () => {
		const harness = new CuaHarness({
			browser,
			client,
			model: "openai:gpt-5.5",
			getApiKey: () => "test-key",
		});
		expect(harness.agent).toBeInstanceOf(Agent);
		expect(harness.agent.state.model.id).toBe("gpt-5.5");
		expect(harness.agent.state.tools.length).toBeGreaterThan(0);
	});
});
