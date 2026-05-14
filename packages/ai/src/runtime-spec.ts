import type { Api, Model, SimpleStreamOptions, Tool } from "@earendil-works/pi-ai";
import { type CuaModelRef, type CuaProvider, getCuaModel, providerForModel } from "./models";
import * as anthropic from "./providers/anthropic/index";
import * as gemini from "./providers/gemini/index";
import * as openai from "./providers/openai/index";
import * as tzafon from "./providers/tzafon/index";
import * as yutori from "./providers/yutori/index";

/**
 * Runtime configuration for a supported CUA model.
 *
 * Use this to pair a model with the tool definitions, baseline prompt, and
 * request payload middleware expected by its provider.
 */
export interface CuaRuntimeSpec {
	model: Model<Api>;
	provider: CuaProvider;
	/** Model-facing CUA tool definitions for this provider. */
	toolDefinitions: Tool[];
	/** Provider-tuned baseline prompt for browser control behavior. */
	defaultSystemPrompt: string;
	/** Optional provider middleware for request payload adaptation. */
	onPayload?: SimpleStreamOptions["onPayload"];
}

export type CuaRuntimeSpecInput = CuaModelRef | Model<Api>;

/**
 * Resolve provider defaults from either a CUA model ref or a concrete model.
 *
 * Use the returned spec to build computer-use requests without hard-coding
 * model-provider rules in your application.
 */
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
		case "google":
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
				onPayload: openai.openaiResponsesStoreOnPayload,
			};
	}
}
