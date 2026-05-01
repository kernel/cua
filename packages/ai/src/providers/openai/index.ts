export {
	CUA_ACTION_TYPES as OPENAI_CUA_ACTION_TYPES,
	CUA_BATCH_TOOL_DESCRIPTION as OPENAI_BATCH_DESCRIPTION,
	CUA_BATCH_TOOL_NAME as OPENAI_BATCH_TOOL_NAME,
	CUA_NAVIGATION_TOOL_DESCRIPTION as OPENAI_EXTRA_TOOL_DESCRIPTION,
	CUA_NAVIGATION_TOOL_NAME as OPENAI_EXTRA_TOOL_NAME,
	CuaBatchSchema as OpenAIBatchSchema,
	CuaNavigationSchema as OpenAIExtraSchema,
} from "../common.js";
export type {
	CuaAction as OpenAIAction,
	CuaBatchInput as OpenAIBatchInput,
	CuaNavigationInput as OpenAIExtraInput,
} from "../common.js";

export const OPENAI_BATCH_INSTRUCTIONS = `You have two browser tools:
1. batch_computer_actions for click, double_click, mouse_down, mouse_up, type, keypress, scroll, move, drag, wait, goto, back, forward, url, cursor_position, and screenshot.
2. computer_use_extra for a single high-level goto, back, forward, or url action.

Prefer batch_computer_actions for predictable multi-step browser interaction. Include explicit url(), cursor_position(), or screenshot() read steps when you need intermediate state.`;
