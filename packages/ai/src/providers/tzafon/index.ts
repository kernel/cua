import type { ComputerToolCoordinateSystem } from "../common.js";

export {
	CUA_ACTION_TYPES as TZAFON_ACTION_TYPES,
	CUA_BATCH_TOOL_DESCRIPTION as TZAFON_BATCH_DESCRIPTION,
	CUA_BATCH_TOOL_NAME as TZAFON_BATCH_TOOL_NAME,
	createComputerToolDefinitions,
	createCuaActionSchema as createActionSchema,
	createCuaBatchSchema as createBatchSchema,
	CuaBatchSchema as TzafonBatchSchema,
} from "../common.js";
export type {
	CuaAction as TzafonAction,
	CreateComputerToolDefinitionsOptions,
	CuaBatchInput as TzafonBatchInput,
} from "../common.js";
export {
	TZAFON_RESPONSES_API,
	streamSimpleTzafonResponses,
	streamTzafonResponses,
} from "./provider.js";

// Sources: https://docs.lightcone.ai/guides/coordinates/ and
// https://huggingface.co/Tzafon/Northstar-CUA-Fast
export const COMPUTER_TOOL_COORDINATES = { type: "normalized", range: [0, 999] } as const satisfies ComputerToolCoordinateSystem;

export const TZAFON_INSTRUCTIONS_RAW = `You control a Kernel cloud browser. Prefer batched computer actions for browser interaction and include screenshot or URL reads when you need updated state.`;

export function buildTzafonSystemPrompt(opts: { suffix?: string } = {}): string {
	return [TZAFON_INSTRUCTIONS_RAW, opts.suffix].filter(Boolean).join("\n\n");
}
