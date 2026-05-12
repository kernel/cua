import type { ComputerToolCoordinateSystem } from "../common";

export {
	CUA_ACTION_TYPES as TZAFON_ACTION_TYPES,
	CUA_BATCH_TOOL_DESCRIPTION as TZAFON_BATCH_DESCRIPTION,
	CUA_BATCH_TOOL_NAME as TZAFON_BATCH_TOOL_NAME,
	createComputerToolDefinitions,
	createCuaActionSchema as createActionSchema,
	createCuaBatchSchema as createBatchSchema,
	CuaBatchSchema as TzafonBatchSchema,
} from "../common";
export type {
	CuaAction as TzafonAction,
	CreateComputerToolDefinitionsOptions,
	CuaBatchInput as TzafonBatchInput,
} from "../common";
export {
	TZAFON_RESPONSES_API,
	streamSimpleTzafonResponses,
	streamTzafonResponses,
} from "./provider";

// Provider-native action vocabulary. The model card lists supported actions;
// the Responses API loop dispatches on `action.type` and adds terminal control
// types (`answer`, `done`).
//   Model actions: click, double_click, triple_click, right_click, drag, type,
//                  key, scroll, hscroll, navigate, wait, terminate
//   Responses API `action.type` also includes: keypress, answer, done
// Sources:
//   https://huggingface.co/Tzafon/Northstar-CUA-Fast
//   https://docs.lightcone.ai/guides/cua-protocol/
//   https://docs.lightcone.ai/guides/coordinates/
export const COMPUTER_TOOL_COORDINATES = { type: "normalized", range: [0, 999] } as const satisfies ComputerToolCoordinateSystem;

export const TZAFON_INSTRUCTIONS_RAW = `You control a Kernel cloud browser. Prefer batched computer actions for browser interaction and include screenshot or URL reads when you need updated state.`;

export function buildTzafonSystemPrompt(opts: { suffix?: string } = {}): string {
	return [TZAFON_INSTRUCTIONS_RAW, opts.suffix].filter(Boolean).join("\n\n");
}
