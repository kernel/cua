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
} from "./batch.js";
export type { BatchToolDetails, BatchToolInput } from "./batch.js";
export {
	executeOpenAIExtraAction,
	ExtraSchema,
	OPENAI_EXTRA_TOOL,
	OPENAI_EXTRA_TOOL_DESCRIPTION,
	OPENAI_EXTRA_TOOL_NAME,
} from "./extra.js";
export type { ExtraToolDetails, ExtraToolInput } from "./extra.js";
export {
	OPENAI_OFFICIAL_ACTION_TYPES,
	OpenAIOfficialActionSchema,
	OpenAIPointSchema,
} from "./official.js";
export type { OpenAIOfficialAction, OpenAIOfficialActionType, OpenAIPoint } from "./official.js";
export {
	OPENAI_CUA_EXTRA_ACTION_TYPES,
	OpenAICuaExtraActionSchema,
} from "./cua-extras.js";
export type { OpenAICuaExtraAction, OpenAICuaExtraActionType } from "./cua-extras.js";
export {
	executeOpenAIToolCall,
	openai,
	openaiTools,
} from "./model.js";
export type {
	OpenAIModelOptions,
	OpenAIModelRunDetails,
	OpenAIToolCallResultDetails,
	OpenAIToolSpec,
} from "./model.js";
export {
	OPENAI_BATCH_INSTRUCTIONS,
	OPENAI_NATIVE_COMPUTER_INSTRUCTIONS,
} from "./system-prompt.js";
