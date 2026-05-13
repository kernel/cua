import type { Api, Model, SimpleStreamOptions, Tool } from "@earendil-works/pi-ai";
import { type CuaModelRef, type CuaProvider, getCuaModel, providerForModel } from "./models";
import * as anthropic from "./providers/anthropic/index";
import * as gemini from "./providers/gemini/index";
import * as openai from "./providers/openai/index";
import * as tzafon from "./providers/tzafon/index";
import * as yutori from "./providers/yutori/index";

/**
 * Provider-resolved runtime defaults for CUA execution.
 *
 * `@onkernel/cua-agent` consumes this shape so it can stay provider-neutral:
 * it only needs model, tool definitions, and optional payload middleware,
 * without branching on provider-specific quirks.
 */
export interface CuaRuntimeSpec {
	model: Model<Api>;
	provider: CuaProvider;
	/** Canonical CUA tool definitions exposed to the model. */
	toolDefinitions: Tool[];
	/** Provider-tuned baseline prompt for browser control behavior. */
	defaultSystemPrompt: string;
	/** Optional provider middleware for request payload adaptation. */
	onPayload?: SimpleStreamOptions["onPayload"];
}

export type CuaRuntimeSpecInput = CuaModelRef | Model<Api>;

/**
 * Resolve provider-owned policy from either a CUA model ref or a concrete model.
 *
 * This is intentionally the only place where provider-specific defaults are
 * selected. Callers should consume the returned spec and avoid branching on
 * provider names directly.
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
				onPayload: openai.openaiResponsesStoreOnPayload,
			};
	}
}
