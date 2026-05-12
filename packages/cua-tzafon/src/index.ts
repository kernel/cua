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
} from "./coords";
export {
	executeTzafonFunctionCall,
	getTzafonDefinition,
	splitKeyCombo,
	TZAFON_FUNCTION_TOOLS,
} from "./computer";
export type {
	TzafonComputerToolsOptions,
	TzafonToolDetails,
} from "./computer";
export {
	TzafonAction,
	DEFAULT_TZAFON_SCREEN_SIZE,
	TZAFON_ACTIONS,
	TZAFON_COORDINATE_SCALE,
	TZAFON_DEFAULT_MODEL,
} from "./official";
export type {
	TzafonActionName,
	TzafonScreenSize,
} from "./official";
export { tzafon } from "./model";
export type {
	TzafonModelOptions,
	TzafonModelRunDetails,
} from "./model";
export {
	buildTzafonSystemPrompt,
	TZAFON_INSTRUCTIONS_RAW,
} from "./system-prompt";
export type { TzafonSystemPromptOptions } from "./system-prompt";
