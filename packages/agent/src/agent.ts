import {
	Agent,
	type AgentOptions,
	type AgentTool,
} from "@mariozechner/pi-agent-core";
import {
	type Api,
	type Model,
	type SimpleStreamOptions,
	type CuaModelRef,
	getCuaModel,
	providerForModel,
	streamSimple,
	anthropic,
	gemini,
	openai,
	tzafon,
	yutori,
} from "@onkernel/cua-ai";
import type Kernel from "@onkernel/sdk";
import { createCuaComputerTools } from "./tools.js";
import type { KernelBrowser } from "./translator/translator.js";

export type CreateCuaAgentOptions = Omit<AgentOptions, "initialState"> & {
	browser: KernelBrowser;
	client?: Kernel;
	initialState: Omit<NonNullable<AgentOptions["initialState"]>, "model" | "tools"> & {
		model: CuaModelRef | Model<Api>;
		tools?: AgentTool<any, any>[];
	};
};

export function createCuaAgent(options: CreateCuaAgentOptions): Agent {
	const model = typeof options.initialState.model === "string" ? getCuaModel(options.initialState.model) : options.initialState.model;
	const provider = providerForModel(model);
	const tools = options.initialState.tools ?? createCuaComputerTools({ provider, browser: options.browser, client: options.client });
	const systemPrompt = options.initialState.systemPrompt ?? defaultSystemPrompt(provider);
	const onPayload = composeOnPayload(defaultOnPayload(provider), options.onPayload);

	return new Agent({
		...options,
		streamFn: options.streamFn ?? streamSimple,
		onPayload,
		initialState: {
			...options.initialState,
			model,
			tools,
			systemPrompt,
		},
	});
}

function defaultSystemPrompt(provider: ReturnType<typeof providerForModel>): string {
	switch (provider) {
		case "anthropic":
			return anthropic.buildAnthropicSystemPrompt();
		case "gemini":
			return gemini.buildGeminiSystemPrompt();
		case "tzafon":
			return tzafon.buildTzafonSystemPrompt();
		case "yutori":
			return yutori.buildYutoriSystemPrompt();
		case "openai":
		default:
			return openai.OPENAI_BATCH_INSTRUCTIONS;
	}
}

function defaultOnPayload(provider: ReturnType<typeof providerForModel>): SimpleStreamOptions["onPayload"] | undefined {
	if (provider === "yutori") return yutori.yutoriBuiltinToolsOnPayload;
	return undefined;
}

function composeOnPayload(
	first: SimpleStreamOptions["onPayload"] | undefined,
	second: SimpleStreamOptions["onPayload"] | undefined,
): SimpleStreamOptions["onPayload"] | undefined {
	if (!first) return second;
	if (!second) return first;
	return async (payload, model) => {
		const afterFirst = await first(payload, model);
		return second(afterFirst ?? payload, model);
	};
}
