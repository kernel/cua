import type { ComputerToolCoordinateSystem } from "../common";

export {
	CUA_ACTION_TYPES as ANTHROPIC_CUA_ACTION_TYPES,
	CUA_BATCH_TOOL_DESCRIPTION as ANTHROPIC_BATCH_DESCRIPTION,
	CUA_BATCH_TOOL_NAME as ANTHROPIC_BATCH_TOOL_NAME,
	createComputerToolDefinitions,
	createCuaActionSchema as createActionSchema,
	createCuaBatchSchema as createBatchSchema,
	CuaBatchSchema as AnthropicBatchSchema,
} from "../common";
export type {
	CuaAction as AnthropicAction,
	CreateComputerToolDefinitionsOptions,
	CuaBatchInput as AnthropicBatchInput,
} from "../common";

// Provider-native action vocabulary emitted on `tool_use.input.action`. Latest
// tool version is `computer_20251124`, which extends earlier dated versions:
//   computer_20241022: key, type, mouse_move, left_click, left_click_drag,
//                      right_click, middle_click, double_click, screenshot,
//                      cursor_position
//   computer_20250124: + left_mouse_down, left_mouse_up, scroll, hold_key,
//                        wait, triple_click
//   computer_20251124: + zoom
// Source: https://github.com/anthropics/anthropic-quickstarts/blob/main/computer-use-demo/computer_use_demo/tools/computer.py
export const COMPUTER_TOOL_COORDINATES = { type: "pixel" } as const satisfies ComputerToolCoordinateSystem;

export const ANTHROPIC_COMPUTER_INSTRUCTIONS = `You control a Kernel cloud browser through computer-use tools. Use batched actions for predictable browser interaction, keyboard navigation where possible, and explicit screenshot or url reads when you need to inspect state.`;

export function buildAnthropicSystemPrompt(opts: { suffix?: string } = {}): string {
	return [ANTHROPIC_COMPUTER_INSTRUCTIONS, opts.suffix].filter(Boolean).join("\n\n");
}
