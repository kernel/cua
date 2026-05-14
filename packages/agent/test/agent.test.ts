import { describe, expect, it } from "vitest";
import { createAssistantMessageEventStream, type AssistantMessage } from "@earendil-works/pi-ai";
import { resolveCuaRuntimeSpec } from "@onkernel/cua-ai";
import type Kernel from "@onkernel/sdk";
import {
	Agent,
	AgentHarness,
	CuaAgent,
	CuaAgentHarness,
	InMemorySessionRepo,
	NodeExecutionEnv,
	createCuaComputerTools,
	type AgentTool,
	type KernelBrowser,
	type StreamFn,
} from "../src/index";

const browser = { session_id: "browser_123" } as KernelBrowser;
const client = {} as Kernel;

function createAssistantMessage(model: { api: string; provider: string; id: string }): AssistantMessage {
	return {
		role: "assistant",
		content: [],
		api: model.api,
		provider: model.provider,
		model: model.id,
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "stop",
		timestamp: Date.now(),
	};
}

async function createHarnessServices() {
	const sessionRepo = new InMemorySessionRepo();
	return {
		env: new NodeExecutionEnv({ cwd: process.cwd() }),
		session: await sessionRepo.create(),
	};
}

describe("CuaAgent", () => {
	it("extends pi Agent and resolves model refs in initialState", () => {
		const runtime = resolveCuaRuntimeSpec("openai:gpt-5.5");
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
		expect(agent.state.systemPrompt).toBe(runtime.defaultSystemPrompt);
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
			} satisfies AgentTool,
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

	it("refreshes CUA runtime state when state.model changes", () => {
		const runtime = resolveCuaRuntimeSpec("google:gemini-3-pro-preview");
		const agent = new CuaAgent({
			browser,
			client,
			initialState: {
				model: "openai:gpt-5.5",
			},
		});

		agent.state.model = "google:gemini-3-pro-preview";

		expect(agent.state.model.id).toBe(runtime.model.id);
		expect(agent.state.systemPrompt).toBe(runtime.defaultSystemPrompt);
		expect(agent.state.tools).toHaveLength(runtime.toolDefinitions.length);
	});

	it("keeps caller-owned tools and system prompt when state.model changes", () => {
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
				model: "openai:gpt-5.5",
				tools: [tool],
				systemPrompt: "custom prompt",
			},
		});

		agent.state.model = "google:gemini-3-pro-preview";

		expect(agent.state.tools).toEqual([tool]);
		expect(agent.state.systemPrompt).toBe("custom prompt");
	});

	it("composes payload hooks for custom stream functions", async () => {
		const payloads: unknown[] = [];
		const streamFn: StreamFn = (model, _context, options) => {
			const stream = createAssistantMessageEventStream();
			void (async () => {
				payloads.push(await options?.onPayload?.({ provider: model.provider }, model));
				const message = createAssistantMessage(model);
				stream.push({ type: "start", partial: message });
				stream.push({ type: "done", reason: "stop", message });
				stream.end(message);
			})();
			return stream;
		};

		const agent = new CuaAgent({
			browser,
			client,
			streamFn,
			onPayload: (payload) => ({ payload, userHook: true }),
			initialState: {
				model: "openai:gpt-5.5",
			},
		});

		await agent.prompt("hello");

		expect(payloads).toEqual([{ payload: { provider: "openai", store: true }, userHook: true }]);
	});
});

describe("CuaAgentHarness", () => {
	it("extends pi AgentHarness and resolves model refs", async () => {
		const harness = new CuaAgentHarness({
			...(await createHarnessServices()),
			browser,
			client,
			model: "openai:gpt-5.5",
			getApiKeyAndHeaders: async () => ({ apiKey: "test-key" }),
		});
		expect(harness).toBeInstanceOf(AgentHarness);
		expect(harness.agent).toBeInstanceOf(Agent);
		expect(harness.agent.state.model.id).toBe("gpt-5.5");
		expect(harness.agent.state.tools.length).toBeGreaterThan(0);
	});

	it("refreshes CUA runtime state through setModel", async () => {
		const runtime = resolveCuaRuntimeSpec("google:gemini-3-pro-preview");
		const harness = new CuaAgentHarness({
			...(await createHarnessServices()),
			browser,
			client,
			model: "openai:gpt-5.5",
		});

		await harness.setModel("google:gemini-3-pro-preview");

		expect(harness.agent.state.model.id).toBe(runtime.model.id);
		expect(harness.agent.state.tools).toHaveLength(runtime.toolDefinitions.length);
	});

	it("preserves active tool selection when setModel refreshes tools", async () => {
		const harness = new CuaAgentHarness({
			...(await createHarnessServices()),
			browser,
			client,
			model: "openai:gpt-5.5",
		});

		await harness.setActiveTools([]);
		await harness.setModel("google:gemini-3-pro-preview");

		expect(harness.agent.state.tools).toEqual([]);
	});

	it("keeps runtime spec unchanged if setModel fails validation", async () => {
		const runtime = resolveCuaRuntimeSpec("openai:gpt-5.5");
		const harness = new CuaAgentHarness({
			...(await createHarnessServices()),
			browser,
			client,
			model: "openai:gpt-5.5",
		});

		(harness as unknown as { requestedActiveToolNames?: string[] }).requestedActiveToolNames = ["missing-tool"];

		await expect(harness.setModel("google:gemini-3-pro-preview")).rejects.toThrow("Unknown tool(s): missing-tool");
		expect(harness.agent.state.model.id).toBe(runtime.model.id);
		expect((harness as unknown as { runtime: { model: { id: string } } }).runtime.model.id).toBe(runtime.model.id);
	});
});
