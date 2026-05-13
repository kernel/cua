/**
 * @onkernel/cua-openai
 *
 * Provider-neutral OpenAI computer-use helpers backed by
 * `@onkernel/cua-translator`. The package root exports:
 *
 * - OpenAI model factory for single-invocation `runComputerUse()` calls
 * - plain tool specs / execution helpers for hand-rolled non-pi loops
 * - official action enums / schemas and prompt constants
 *
 * `pi-agent-core` bindings live under `@onkernel/cua-openai/pi`.
 */

export {
	BatchSchema,
	executeOpenAIBatch,
	OPENAI_BATCH_DESCRIPTION,
	OPENAI_BATCH_TOOL,
	OPENAI_BATCH_TOOL_NAME,
} from "./batch";
export type { BatchToolDetails, BatchToolInput } from "./batch";
export {
	executeOpenAIExtraAction,
	ExtraSchema,
	OPENAI_EXTRA_TOOL,
	OPENAI_EXTRA_TOOL_DESCRIPTION,
	OPENAI_EXTRA_TOOL_NAME,
} from "./extra";
export type { ExtraToolDetails, ExtraToolInput } from "./extra";
export {
	OPENAI_OFFICIAL_ACTION_TYPES,
	OpenAIOfficialActionSchema,
	OpenAIPointSchema,
} from "./official";
export type { OpenAIOfficialAction, OpenAIOfficialActionType, OpenAIPoint } from "./official";
export {
	OPENAI_CUA_EXTRA_ACTION_TYPES,
	OpenAICuaExtraActionSchema,
} from "./cua-extras";
export type { OpenAICuaExtraAction, OpenAICuaExtraActionType } from "./cua-extras";
export {
	executeOpenAIToolCall,
	openai,
	openaiTools,
} from "./model";
export type {
	OpenAIModelOptions,
	OpenAIModelRunDetails,
	OpenAIToolCallResultDetails,
	OpenAIToolSpec,
} from "./model";
export {
	OPENAI_BATCH_INSTRUCTIONS,
	OPENAI_NATIVE_COMPUTER_INSTRUCTIONS,
} from "./system-prompt";
