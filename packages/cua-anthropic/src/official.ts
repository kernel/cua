/**
 * Anthropic computer-use action set.
 *
 * Source of truth: Anthropic's "Computer use" docs.
 *   https://docs.claude.com/en/docs/agents-and-tools/computer-use
 *   https://docs.claude.com/en/docs/agents-and-tools/tool-use/overview#computer-use
 *
 * Anthropic ships THREE versions of the built-in `computer` tool. The action
 * vocabulary grows monotonically across versions. We register the latest
 * compatible version for each model and translate every action up through
 * `zoom` (with a few we mark unsupported because the Kernel browser does not
 * expose them today).
 *
 * Model → tool version pairing (per Anthropic docs):
 *   computer_20241022 → claude-3-5-sonnet (oct 22)
 *   computer_20250124 → claude-3-7-sonnet, claude-sonnet-4, claude-opus-4,
 *                        claude-opus-4-1, claude-sonnet-4-5, claude-haiku-4-5
 *   computer_20251124 → claude-opus-4-5+, claude-opus-4-6+, claude-opus-4-7+,
 *                        claude-sonnet-4-6+
 *
 * The beta header is automatically merged in by {@link wrapAnthropicStream}.
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

function buildAnthropicComputerTool(type: AnthropicComputerToolVersion) {
	return {
		type,
		name: "computer",
		display_width_px: ANTHROPIC_DISPLAY.width,
		display_height_px: ANTHROPIC_DISPLAY.height,
		display_number: ANTHROPIC_DISPLAY.number,
		...(type === "computer_20251124" ? { enable_zoom: false } : {}),
	} as const;
}

export const ANTHROPIC_COMPUTER_TOOL_20250124 = buildAnthropicComputerTool("computer_20250124");
export const ANTHROPIC_COMPUTER_TOOL_20251124 = buildAnthropicComputerTool("computer_20251124");

/**
 * Default built-in computer tool spec. Sent in the Anthropic Messages API
 * `tools` array. Not a JSON schema — Anthropic accepts a small fixed set
 * of named built-in tools; the model knows the per-action shape internally.
 */
export const ANTHROPIC_COMPUTER_TOOL = ANTHROPIC_COMPUTER_TOOL_20251124;

export function anthropicComputerToolForModel(modelId: string): typeof ANTHROPIC_COMPUTER_TOOL_20250124 | typeof ANTHROPIC_COMPUTER_TOOL_20251124 {
	return anthropicComputerToolVersionForModel(modelId) === "computer_20251124"
		? ANTHROPIC_COMPUTER_TOOL_20251124
		: ANTHROPIC_COMPUTER_TOOL_20250124;
}

export function anthropicComputerToolVersionForModel(modelId: string): Exclude<AnthropicComputerToolVersion, "computer_20241022"> {
	const id = modelId.toLowerCase();
	if (
		id.startsWith("claude-opus-4-7") ||
		id.startsWith("claude-opus-4-6") ||
		id.startsWith("claude-opus-4-5") ||
		id.startsWith("claude-sonnet-4-6")
	) {
		return "computer_20251124";
	}
	return "computer_20250124";
}

/**
 * Computer-use beta headers. The value must match the selected built-in
 * computer tool version for the target model.
 */
export const ANTHROPIC_COMPUTER_USE_BETA_20250124 = "computer-use-2025-01-24";
export const ANTHROPIC_COMPUTER_USE_BETA_20251124 = "computer-use-2025-11-24";
export const ANTHROPIC_COMPACTION_BETA = "compact-2026-01-12";
export const ANTHROPIC_COMPACTION_EDIT_TYPE = "compact_20260112";
export const ANTHROPIC_COMPACTION_MIN_TRIGGER_TOKENS = 50_000;

export function anthropicComputerUseBetaForModel(modelId: string): typeof ANTHROPIC_COMPUTER_USE_BETA_20250124 | typeof ANTHROPIC_COMPUTER_USE_BETA_20251124 {
	return anthropicComputerToolVersionForModel(modelId) === "computer_20251124"
		? ANTHROPIC_COMPUTER_USE_BETA_20251124
		: ANTHROPIC_COMPUTER_USE_BETA_20250124;
}

/**
 * Latest computer-use beta header value. Kept for callers that do not have a
 * model ID available; runtime paths should prefer
 * {@link anthropicComputerUseBetaForModel}.
 */
export const ANTHROPIC_COMPUTER_USE_BETA = ANTHROPIC_COMPUTER_USE_BETA_20251124;

export function anthropicSupportsCompaction(modelId: string): boolean {
	const id = modelId.toLowerCase();
	return (
		id.startsWith("claude-mythos-preview") ||
		id.startsWith("claude-opus-4-7") ||
		id.startsWith("claude-opus-4-6") ||
		id.startsWith("claude-sonnet-4-6")
	);
}
