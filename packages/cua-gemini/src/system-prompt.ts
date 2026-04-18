/**
 * Gemini system-prompt preamble for the predefined computer-use functions
 * + cua-added `batch_computer_actions` tool surface.
 */

const GEMINI_COMPUTER_INSTRUCTIONS = `You control a 1920x1080 cloud browser through a set of computer-use tools.
Each tool returns a fresh screenshot after the action completes so you can
verify the result before planning the next step.

Predefined tools (Gemini computer-use functions):
- All x / y arguments are normalized to the 0-1000 range (NOT pixels).
- click_at, hover_at, type_text_at, scroll_at, drag_and_drop take normalized (x, y).
- type_text_at can clear the field first (clear_before_typing, default true) and press Enter (press_enter).
- scroll_document scrolls the viewport from its center; magnitude is in pixels.
- navigate {url} opens a fresh page (focuses the address bar, types, presses Enter).
- go_back / go_forward use Alt+Left / Alt+Right.
- key_combination accepts a single string like "ctrl+l", "Return", or "shift+Tab".
- wait_5_seconds sleeps 5s for asynchronous UI to settle.

Verification pattern: after multi-step changes, take a screenshot and explicitly
confirm what you see ("I see X, so step Y succeeded") before continuing.`;

const GEMINI_BATCH_INSTRUCTIONS = `You also have a \`batch_computer_actions\` tool that bundles multiple actions
into a single call (with optional inline url() and screenshot() reads).
PREFER \`batch_computer_actions\` over the predefined per-action tools for
predictable sequences such as:
- Clicking a text field, typing text, and pressing Enter
- Dragging an item with mid-batch screenshot reads
- Reading the current URL via url() (the cua-added action — Gemini's
  predefined functions don't expose this)

IMPORTANT: \`batch_computer_actions\` uses PIXEL coordinates (x and y in
pixels), NOT the 0-1000 normalized coordinates the predefined tools use.
Mixing the two will not work — pick one tool per call and follow its
coordinate convention.`;

export interface GeminiSystemPromptOptions {
	/** Set false to omit the batch nudge (e.g. when batch is disabled). Defaults to true. */
	includeBatchNudge?: boolean;
}

export function buildGeminiSystemPrompt(opts: GeminiSystemPromptOptions = {}): string {
	if (opts.includeBatchNudge === false) return GEMINI_COMPUTER_INSTRUCTIONS;
	return `${GEMINI_COMPUTER_INSTRUCTIONS}\n\n${GEMINI_BATCH_INSTRUCTIONS}`;
}

export const GEMINI_INSTRUCTIONS_RAW = {
	computer: GEMINI_COMPUTER_INSTRUCTIONS,
	batch: GEMINI_BATCH_INSTRUCTIONS,
};
