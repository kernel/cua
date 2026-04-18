/**
 * @onkernel/cua-gemini
 *
 * Provider-neutral Gemini computer-use helpers backed by
 * `@onkernel/cua-translator`.
 *
 * The package root exports:
 * - Gemini model factory for single-invocation `runComputerUse()` calls
 * - plain function declarations / execution helpers for non-pi loops
 * - Gemini action enums, coordinate helpers, and prompt builders
 *
 * `pi-agent-core` bindings live under `@onkernel/cua-gemini/pi`.
 */

export {
	executeGeminiBatch,
	GeminiBatchSchema,
	GEMINI_BATCH_DESCRIPTION,
	GEMINI_BATCH_FUNCTION_DECLARATION,
	GEMINI_BATCH_TOOL_NAME,
} from "./batch.js";
export type { GeminiBatchToolInput, GeminiBatchToolDetails } from "./batch.js";
export {
	executeGeminiFunctionCall,
	GEMINI_FUNCTION_DECLARATIONS,
} from "./computer.js";
export type { GeminiComputerToolsOptions, GeminiToolDetails } from "./computer.js";
export {
	GeminiAction,
	PREDEFINED_COMPUTER_USE_FUNCTIONS,
	DEFAULT_GEMINI_SCREEN_SIZE,
	GEMINI_COORDINATE_SCALE,
} from "./official.js";
export type {
	GeminiFunctionArgs,
	GeminiScreenSize,
	ScrollDirection,
} from "./official.js";
export { gemini } from "./model.js";
export type {
	GeminiModelOptions,
	GeminiModelRunDetails,
} from "./model.js";
export { denormalizeX, denormalizeY } from "./coords.js";
export { GEMINI_CUA_EXTRA_ACTION_TYPES } from "./cua-extras.js";
export type { GeminiCuaExtraActionType } from "./cua-extras.js";
export {
	buildGeminiSystemPrompt,
	GEMINI_INSTRUCTIONS_RAW,
} from "./system-prompt.js";
export type { GeminiSystemPromptOptions } from "./system-prompt.js";
