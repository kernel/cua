import type { ComputerToolCoordinateSystem } from "../common";

export {
	CUA_ACTION_TYPES as ANTHROPIC_CUA_ACTION_TYPES,
	computerTools,
	createCuaActionSchema as createActionSchema,
} from "../common";
export type {
	CuaAction as AnthropicAction,
	ComputerToolsOptions,
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

export const ANTHROPIC_COMPUTER_INSTRUCTIONS = `You control a Kernel cloud browser through individual browser tools. Use keyboard navigation where possible, and request explicit screenshot or url reads when you need to inspect state.`;

export function buildAnthropicSystemPrompt(opts: { suffix?: string } = {}): string {
	return [ANTHROPIC_COMPUTER_INSTRUCTIONS, opts.suffix].filter(Boolean).join("\n\n");
}
