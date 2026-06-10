import type { ComputerToolCoordinateSystem, CuaProviderModule } from "../common.js";
import { computerToolExecutors } from "./actions.js";
import { yutoriNativeToolSetOnPayload } from "./provider.js";

export {
	computerToolExecutors,
	computerTools,
	toCanonicalActions,
	yutoriNativeActionsForModel,
	yutoriToolSetForModel,
	YUTORI_CANONICAL_ACTION_TYPES,
	YUTORI_N1_ACTION_TYPES,
	YUTORI_N15_ACTION_TYPES,
	YUTORI_N15_CORE_ACTION_TYPES,
	YUTORI_N15_CORE_TOOL_SET,
	YUTORI_N15_EXPANDED_ACTION_TYPES,
	YUTORI_N15_EXPANDED_TOOL_SET,
} from "./actions.js";
export type { YutoriN1ActionType, YutoriN15CoreActionType, YutoriN15ExpandedActionType, YutoriNativeActionType } from "./actions.js";
export {
	YUTORI_CHAT_COMPLETIONS_API,
	streamSimpleYutori,
	streamYutori,
	yutoriNativeToolSetOnPayload,
} from "./provider.js";

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
//   https://docs.yutori.com/reference/n1
//   https://docs.yutori.com/reference/n1-5
//   https://docs.yutori.com/llm-quickstart.md
//   https://github.com/yutori-ai/yutori-sdk-python/blob/main/yutori/navigator/coordinates.py
export function coordinateSystem(): ComputerToolCoordinateSystem {
	return { type: "normalized", range: [0, 1000] };
}

// Yutori's Navigator quickstart recommends putting extra instructions in the
// first user message instead of supplying a custom system prompt.
// Source: https://docs.yutori.com/llm-quickstart.md
export const YUTORI_INSTRUCTIONS_RAW = "";

export function buildYutoriSystemPrompt(opts: { suffix?: string } = {}): string {
	return [YUTORI_INSTRUCTIONS_RAW, opts.suffix].filter(Boolean).join("\n\n");
}

export const providerModule = {
	toolDefinitions: () => [],
	toolExecutors: computerToolExecutors,
	coordinateSystem,
	buildSystemPrompt: buildYutoriSystemPrompt,
	onPayload: yutoriNativeToolSetOnPayload,
	screenshot: {
		appendToLatestMessage: true,
		transform: { width: 1280, height: 800, format: "webp", quality: 90 },
	},
} satisfies CuaProviderModule;
