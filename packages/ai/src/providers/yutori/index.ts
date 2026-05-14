import type { ComputerToolCoordinateSystem } from "../common";

export {
	createComputerToolDefinitions,
	isYutoriNativeActionName,
	toCanonicalActions,
	yutoriNativeActionsForModel,
	yutoriToolSetForModel,
	YUTORI_N1_ACTION_TYPES,
	YUTORI_N15_ACTION_TYPES,
	YUTORI_N15_CORE_ACTION_TYPES,
	YUTORI_N15_CORE_TOOL_SET,
	YUTORI_N15_EXPANDED_ACTION_TYPES,
	YUTORI_N15_EXPANDED_TOOL_SET,
} from "./actions";
export type { YutoriN1ActionType, YutoriN15CoreActionType, YutoriN15ExpandedActionType, YutoriNativeActionType } from "./actions";
export {
	YUTORI_CHAT_COMPLETIONS_API,
	streamSimpleYutori,
	streamYutori,
	yutoriBuiltinToolsOnPayload,
	yutoriNativeToolSetOnPayload,
} from "./provider";

// Provider-native action vocabulary differs between Navigator versions:
//   n1 (fixed tool set):
//     left_click, double_click, right_click, triple_click, type, key_press,
//     scroll, hover, drag, goto_url, go_back, refresh, wait
//   n1.5 core (browser_tools_core-20260403):
//     left_click, double_click, triple_click, middle_click, right_click,
//     mouse_move (replaces hover), mouse_down, mouse_up, drag, scroll, type,
//     key_press, hold_key, goto_url, go_back, go_forward, refresh, wait
//   n1.5 expanded (browser_tools_expanded-20260403): core +
//     extract_elements, find, set_element_value, execute_js
// Sources:
//   https://github.com/yutori-ai/yutori-sdk-python/blob/main/api.md
//   https://github.com/yutori-ai/yutori-sdk-python/blob/main/yutori/navigator/models.py
//   https://docs.yutori.com/reference/n1-5
//   https://github.com/yutori-ai/yutori-sdk-python/blob/main/yutori/navigator/coordinates.py
export const COMPUTER_TOOL_COORDINATES = { type: "normalized", range: [0, 1000] } as const satisfies ComputerToolCoordinateSystem;

export const YUTORI_INSTRUCTIONS_RAW = "";

export function buildYutoriSystemPrompt(opts: { suffix?: string } = {}): string {
	return [YUTORI_INSTRUCTIONS_RAW, opts.suffix].filter(Boolean).join("\n\n");
}
