import type { Api, Model, Tool } from "@earendil-works/pi-ai";
import { type CuaModelRef, type CuaProvider, getCuaModel, providerForModel } from "./models";
import * as anthropic from "./providers/anthropic/index";
import * as gemini from "./providers/gemini/index";
import * as openai from "./providers/openai/index";
import * as tzafon from "./providers/tzafon/index";
import * as yutori from "./providers/yutori/index";
import type { ComputerToolCoordinateSystem, CuaToolExecutorSpec } from "./providers/common";

export interface CuaScreenshotTransformSpec {
	width: number;
	height: number;
	format: "png" | "jpeg" | "webp";
	quality?: number;
}

export interface CuaScreenshotSpec {
	/** Append a provider-prepared screenshot to the latest user/tool message before each request. */
	appendToLatestMessage?: boolean;
	/** Optional image transform applied to Kernel screenshots before they are sent to the provider. */
	transform?: CuaScreenshotTransformSpec;
}

export interface CuaPayloadContext {
	/** Tool names that should remain in the outbound provider payload even if the provider strips local CUA executors. */
	keepToolNames?: readonly string[];
}

export type CuaPayloadHook = (payload: unknown, model: Model<Api>, context?: CuaPayloadContext) => unknown | Promise<unknown>;

/**
 * Runtime configuration for a supported CUA model.
 *
 * Use this to pair a model with the agent tool definitions, baseline prompt,
 * coordinate convention, screenshot policy, and request payload middleware
 * expected by its provider.
 */
export interface CuaRuntimeSpec {
	model: Model<Api>;
	provider: CuaProvider;
	/** Provider-facing CUA tool definitions used for model requests. */
	toolDefinitions: Tool[];
	/** Local execution adapters that turn provider tool calls into canonical CUA actions. */
	toolExecutors: CuaToolExecutorSpec[];
	/** Provider-tuned baseline prompt for browser control behavior. */
	defaultSystemPrompt: string;
	/** Coordinate convention emitted by provider tool calls. */
	coordinateSystem: ComputerToolCoordinateSystem;
	/** Optional provider screenshot input policy used by CuaAgent/CuaAgentHarness. */
	screenshot?: CuaScreenshotSpec;
	/** Optional provider middleware for request payload adaptation. */
	onPayload?: CuaPayloadHook;
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
				toolDefinitions: anthropic.computerTools(),
				toolExecutors: anthropic.computerToolExecutors(),
				defaultSystemPrompt: anthropic.buildAnthropicSystemPrompt(),
				coordinateSystem: anthropic.COMPUTER_TOOL_COORDINATES,
			};
		case "google":
			return {
				model,
				provider,
				toolDefinitions: gemini.computerTools(),
				toolExecutors: gemini.computerToolExecutors(),
				defaultSystemPrompt: gemini.buildGeminiSystemPrompt(),
				coordinateSystem: gemini.COMPUTER_TOOL_COORDINATES,
			};
		case "tzafon":
			return {
				model,
				provider,
				toolDefinitions: tzafon.computerTools(),
				toolExecutors: tzafon.computerToolExecutors(),
				defaultSystemPrompt: tzafon.buildTzafonSystemPrompt(),
				coordinateSystem: tzafon.COMPUTER_TOOL_COORDINATES,
				onPayload: tzafon.tzafonComputerUseOnPayload,
			};
		case "yutori":
			return {
				model,
				provider,
				toolDefinitions: [],
				toolExecutors: yutori.computerToolExecutors(),
				defaultSystemPrompt: yutori.buildYutoriSystemPrompt(),
				coordinateSystem: yutori.COMPUTER_TOOL_COORDINATES,
				screenshot: {
					appendToLatestMessage: true,
					transform: { width: 1280, height: 800, format: "webp", quality: 90 },
				},
				onPayload: yutori.yutoriBuiltinToolsOnPayload,
			};
		case "openai":
		default:
			return {
				model,
				provider,
				toolDefinitions: openai.computerTools(),
				toolExecutors: openai.computerToolExecutors(),
				defaultSystemPrompt: openai.OPENAI_COMPUTER_INSTRUCTIONS,
				coordinateSystem: openai.COMPUTER_TOOL_COORDINATES,
				onPayload: openai.openaiResponsesStoreOnPayload,
			};
	}
}
