export {
	CUA_ACTION_TYPES as YUTORI_ACTION_TYPES,
	CUA_BATCH_TOOL_DESCRIPTION as YUTORI_BATCH_DESCRIPTION,
	CUA_BATCH_TOOL_NAME as YUTORI_BATCH_TOOL_NAME,
	CuaBatchSchema as YutoriBatchSchema,
} from "../common.js";
export type {
	CuaAction as YutoriAction,
	CuaBatchInput as YutoriBatchInput,
} from "../common.js";
export {
	YUTORI_CHAT_COMPLETIONS_API,
	streamSimpleYutori,
	streamYutori,
	yutoriBuiltinToolsOnPayload,
} from "./provider.js";

export const YUTORI_INSTRUCTIONS_RAW = `You control a Kernel cloud browser. Prefer batched computer actions for browser interaction and include screenshot or URL reads when you need updated state.`;

export function buildYutoriSystemPrompt(opts: { suffix?: string } = {}): string {
	return [YUTORI_INSTRUCTIONS_RAW, opts.suffix].filter(Boolean).join("\n\n");
}
