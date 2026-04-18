/**
 * Anthropic computer-use action set.
 *
 * Source of truth: Anthropic's "Computer use" docs.
 *   https://docs.claude.com/en/docs/agents-and-tools/computer-use
 *   https://docs.claude.com/en/docs/agents-and-tools/tool-use/overview#computer-use
 *
 * Anthropic ships THREE versions of the built-in `computer` tool. The action
 * vocabulary grows monotonically across versions. We register the latest
 * (computer_20251124) for Claude Opus 4.7 / 4.6 / Sonnet 4.6 / Opus 4.5
 * and translate every action up through `zoom` (with a few we mark
 * unsupported because the Kernel browser does not expose them today).
 *
 * Model → tool version pairing (per Anthropic docs):
 *   computer_20241022 → claude-3-5-sonnet (oct 22)
 *   computer_20250124 → claude-3-7-sonnet, claude-sonnet-4, claude-opus-4-1
 *   computer_20251124 → claude-sonnet-4-5+, claude-opus-4-5+, claude-opus-4-7+
 *
 * This package always sends the latest (`computer_20251124`) tool spec to
 * the model; the action set is the union of the three. The beta header
 * `computer-use-2025-11-24` is automatically merged in by
 * {@link wrapAnthropicStream}.
 */

export type AnthropicComputerToolVersion =
	| "computer_20241022"
	| "computer_20250124"
	| "computer_20251124";

/**
 * Action types the LATEST (`computer_20251124`) Anthropic computer tool
 * accepts. Earlier tool versions are subsets — see the comments next to
 * each action for which version introduced it.
 */
export const ANTHROPIC_OFFICIAL_ACTION_TYPES = [
	// Original (computer_20241022)
	"key", // press a key combo (e.g. "ctrl+l")
	"type", // type text
	"mouse_move",
	"left_click",
	"left_click_drag",
	"right_click",
	"middle_click",
	"double_click",
	"screenshot",
	"cursor_position",
	// Added in computer_20250124
	"scroll",
	"hold_key",
	"wait",
	"triple_click",
	"left_mouse_down",
	"left_mouse_up",
	// Added in computer_20251124
	"zoom",
] as const;

export type AnthropicOfficialActionType = (typeof ANTHROPIC_OFFICIAL_ACTION_TYPES)[number];

/**
 * Default display dimensions advertised to Anthropic's computer tool.
 * Matches Kernel cloud browser's default 1920×1080 viewport.
 */
export const ANTHROPIC_DISPLAY = {
	width: 1920,
	height: 1080,
	number: 1,
} as const;

/**
 * Built-in computer_20251124 tool spec. Sent in the Anthropic Messages API
 * `tools` array. Not a JSON schema — Anthropic accepts a small fixed set
 * of named built-in tools; the model knows the per-action shape internally.
 */
export const ANTHROPIC_COMPUTER_TOOL = {
	type: "computer_20251124",
	name: "computer",
	display_width_px: ANTHROPIC_DISPLAY.width,
	display_height_px: ANTHROPIC_DISPLAY.height,
	display_number: ANTHROPIC_DISPLAY.number,
	enable_zoom: false,
} as const;

/**
 * Computer-use beta header value for `computer_20251124`. Required to
 * enable the latest computer tool until it leaves beta.
 */
export const ANTHROPIC_COMPUTER_USE_BETA = "computer-use-2025-11-24";
