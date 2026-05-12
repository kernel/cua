import type { ComputerToolCoordinateSystem } from "../common.js";

export {
	CUA_ACTION_TYPES as GEMINI_CUA_ACTION_TYPES,
	CUA_BATCH_TOOL_DESCRIPTION as GEMINI_BATCH_DESCRIPTION,
	CUA_BATCH_TOOL_NAME as GEMINI_BATCH_TOOL_NAME,
	createComputerToolDefinitions,
	createCuaActionSchema as createActionSchema,
	createCuaBatchSchema as createBatchSchema,
	CuaBatchSchema as GeminiBatchSchema,
} from "../common.js";
export type {
	CuaAction as GeminiAction,
	CreateComputerToolDefinitionsOptions,
	CuaBatchInput as GeminiBatchInput,
} from "../common.js";

// Provider-native function names emitted on `functionCall.name` (PREDEFINED_COMPUTER_USE_FUNCTIONS):
//   open_web_browser, click_at, hover_at, type_text_at, scroll_document,
//   scroll_at, wait_5_seconds, go_back, go_forward, search, navigate,
//   key_combination, drag_and_drop
// Coordinates are normalized to 0-999 regardless of input image size.
// Source: https://github.com/google/computer-use-preview/blob/main/agent.py
// Docs: https://ai.google.dev/gemini-api/docs/computer-use
export const COMPUTER_TOOL_COORDINATES = { type: "normalized", range: [0, 999] } as const satisfies ComputerToolCoordinateSystem;

export const GEMINI_INSTRUCTIONS_RAW = `You control a Kernel cloud browser through computer-use tools. Use pixel coordinates, batch predictable action sequences, and request screenshots or URL reads when state changes.`;

export function buildGeminiSystemPrompt(opts: { suffix?: string } = {}): string {
	return [GEMINI_INSTRUCTIONS_RAW, opts.suffix].filter(Boolean).join("\n\n");
}
