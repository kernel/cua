/**
 * @onkernel/cua-tzafon
 *
 * Provider-neutral Tzafon computer-use helpers backed by
 * `@onkernel/cua-translator`.
 *
 * `pi-agent-core` bindings live under `@onkernel/cua-tzafon/pi`.
 */

export {
	denormalizeX,
	denormalizeY,
	parseTzafonCoord,
} from "./coords.js";
export {
	executeTzafonFunctionCall,
	getTzafonDefinition,
	splitKeyCombo,
	TZAFON_FUNCTION_TOOLS,
} from "./computer.js";
export type {
	TzafonComputerToolsOptions,
	TzafonToolDetails,
} from "./computer.js";
export {
	TzafonAction,
	DEFAULT_TZAFON_SCREEN_SIZE,
	TZAFON_ACTIONS,
	TZAFON_COORDINATE_SCALE,
	TZAFON_DEFAULT_MODEL,
} from "./official.js";
export type {
	TzafonActionName,
	TzafonScreenSize,
} from "./official.js";
export { tzafon } from "./model.js";
export type {
	TzafonModelOptions,
	TzafonModelRunDetails,
} from "./model.js";
export {
	buildTzafonSystemPrompt,
	TZAFON_INSTRUCTIONS_RAW,
} from "./system-prompt.js";
export type { TzafonSystemPromptOptions } from "./system-prompt.js";
