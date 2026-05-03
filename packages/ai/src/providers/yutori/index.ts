import type { ComputerToolCoordinateSystem } from "../common.js";

export {
	CUA_ACTION_TYPES as YUTORI_ACTION_TYPES,
	CUA_BATCH_TOOL_DESCRIPTION as YUTORI_BATCH_DESCRIPTION,
	CUA_BATCH_TOOL_NAME as YUTORI_BATCH_TOOL_NAME,
	createComputerToolDefinitions,
	createCuaActionSchema as createActionSchema,
	createCuaBatchSchema as createBatchSchema,
	CuaBatchSchema as YutoriBatchSchema,
} from "../common.js";
export type {
	CuaAction as YutoriAction,
	CreateComputerToolDefinitionsOptions,
	CuaBatchInput as YutoriBatchInput,
} from "../common.js";
export {
	YUTORI_CHAT_COMPLETIONS_API,
	streamSimpleYutori,
	streamYutori,
	yutoriBuiltinToolsOnPayload,
} from "./provider.js";

// Sources: https://docs.yutori.com/reference/navigator and
// https://github.com/yutori-ai/yutori-sdk-python/blob/main/yutori/navigator/coordinates.py
export const COMPUTER_TOOL_COORDINATES = { type: "normalized", range: [0, 1000] } as const satisfies ComputerToolCoordinateSystem;

export const YUTORI_INSTRUCTIONS_RAW = `You control a Kernel cloud browser. Prefer batched computer actions for browser interaction and include screenshot or URL reads when you need updated state.`;

export function buildYutoriSystemPrompt(opts: { suffix?: string } = {}): string {
	return [YUTORI_INSTRUCTIONS_RAW, opts.suffix].filter(Boolean).join("\n\n");
}
