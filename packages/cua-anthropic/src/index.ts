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
} from "./batch";
export type {
	AnthropicBatchToolDetails,
	AnthropicBatchToolInput,
} from "./batch";
export {
	ComputerSchema,
	executeAnthropicComputerAction,
	translateAnthropicAction,
} from "./computer";
export type { AnthropicComputerInput, AnthropicComputerDetails } from "./computer";
export {
	ANTHROPIC_COMPUTER_TOOL,
	ANTHROPIC_COMPACTION_BETA,
	ANTHROPIC_COMPACTION_EDIT_TYPE,
	ANTHROPIC_COMPACTION_MIN_TRIGGER_TOKENS,
	ANTHROPIC_DISPLAY,
	ANTHROPIC_COMPUTER_USE_BETA,
	ANTHROPIC_OFFICIAL_ACTION_TYPES,
	anthropicSupportsCompaction,
} from "./official";
export type {
	AnthropicComputerToolVersion,
	AnthropicOfficialActionType,
} from "./official";
export { ANTHROPIC_CUA_EXTRA_ACTION_TYPES } from "./cua-extras";
export type { AnthropicCuaExtraActionType } from "./cua-extras";
export { anthropic } from "./model";
export type {
	AnthropicModelOptions,
	AnthropicModelRunDetails,
} from "./model";
export {
	compactAnthropicMessagesForRequest,
	hasAnthropicCompactionBlock,
} from "./context";
export {
	buildAnthropicSystemPrompt,
	ANTHROPIC_INSTRUCTIONS_RAW,
} from "./system-prompt";
export type { AnthropicSystemPromptOptions } from "./system-prompt";
