/**
 * @onkernel/cua-anthropic
 *
 * Provider-neutral Anthropic computer-use helpers backed by
 * `@onkernel/cua-translator`.
 *
 * The package root exports:
 * - Anthropic model factory for single-invocation `runComputerUse()` calls
 * - plain computer/batch execution helpers for non-pi loops
 * - Anthropic built-in tool specs and prompt builders
 *
 * `pi-agent-core` bindings live under `@onkernel/cua-anthropic/pi`.
 */

export {
	AnthropicBatchSchema,
	ANTHROPIC_BATCH_ACTION_TYPES,
	ANTHROPIC_BATCH_DESCRIPTION,
	ANTHROPIC_BATCH_TOOL_NAME,
	ANTHROPIC_BATCH_TOOL_WIRE_SPEC,
	executeAnthropicBatch,
	expandTripleClick,
} from "./batch.js";
export type {
	AnthropicBatchToolDetails,
	AnthropicBatchToolInput,
} from "./batch.js";
export {
	ComputerSchema,
	executeAnthropicComputerAction,
	translateAnthropicAction,
} from "./computer.js";
export type { AnthropicComputerInput, AnthropicComputerDetails } from "./computer.js";
export {
	ANTHROPIC_COMPUTER_TOOL,
	ANTHROPIC_DISPLAY,
	ANTHROPIC_COMPUTER_USE_BETA,
	ANTHROPIC_OFFICIAL_ACTION_TYPES,
} from "./official.js";
export type {
	AnthropicComputerToolVersion,
	AnthropicOfficialActionType,
} from "./official.js";
export { ANTHROPIC_CUA_EXTRA_ACTION_TYPES } from "./cua-extras.js";
export type { AnthropicCuaExtraActionType } from "./cua-extras.js";
export { anthropic } from "./model.js";
export type {
	AnthropicModelOptions,
	AnthropicModelRunDetails,
} from "./model.js";
export {
	buildAnthropicSystemPrompt,
	ANTHROPIC_INSTRUCTIONS_RAW,
} from "./system-prompt.js";
export type { AnthropicSystemPromptOptions } from "./system-prompt.js";
