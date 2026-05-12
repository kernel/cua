import type { Api, Model, SimpleStreamOptions, Tool } from "@earendil-works/pi-ai";
import { type CuaModelRef, type CuaProvider, getCuaModel, providerForModel } from "./models.js";
import * as anthropic from "./providers/anthropic/index.js";
import * as gemini from "./providers/gemini/index.js";
import * as openai from "./providers/openai/index.js";
import * as tzafon from "./providers/tzafon/index.js";
import * as yutori from "./providers/yutori/index.js";

export interface CuaRuntimeSpec {
	model: Model<Api>;
	provider: CuaProvider;
	toolDefinitions: Tool[];
	defaultSystemPrompt: string;
	onPayload?: SimpleStreamOptions["onPayload"];
}

export type CuaRuntimeSpecInput = CuaModelRef | Model<Api>;

export function resolveCuaRuntimeSpec(input: CuaRuntimeSpecInput): CuaRuntimeSpec {
	const model = typeof input === "string" ? getCuaModel(input) : input;
	const provider = providerForModel(model);
	switch (provider) {
		case "anthropic":
			return {
				model,
				provider,
				toolDefinitions: anthropic.createComputerToolDefinitions(),
				defaultSystemPrompt: anthropic.buildAnthropicSystemPrompt(),
			};
		case "gemini":
			return {
				model,
				provider,
				toolDefinitions: gemini.createComputerToolDefinitions(),
				defaultSystemPrompt: gemini.buildGeminiSystemPrompt(),
			};
		case "tzafon":
			return {
				model,
				provider,
				toolDefinitions: tzafon.createComputerToolDefinitions(),
				defaultSystemPrompt: tzafon.buildTzafonSystemPrompt(),
			};
		case "yutori":
			return {
				model,
				provider,
				toolDefinitions: yutori.createComputerToolDefinitions(),
				defaultSystemPrompt: yutori.buildYutoriSystemPrompt(),
				onPayload: yutori.yutoriBuiltinToolsOnPayload,
			};
		case "openai":
		default:
			return {
				model,
				provider,
				toolDefinitions: openai.createComputerToolDefinitions(),
				defaultSystemPrompt: openai.OPENAI_BATCH_INSTRUCTIONS,
			};
	}
}
