/**
 * Anthropic Claude system-prompt preamble for the `computer` +
 * `batch_computer_actions` tool surface.
 *
 * Two preambles, joined automatically by {@link buildAnthropicSystemPrompt}:
 *
 *  1. The action-vocabulary preamble (matches Anthropic's documented
 *     `computer_20251124` action shapes and reinforces the
 *     verify-by-screenshot pattern).
 *  2. A short nudge towards the cua-added `batch_computer_actions` tool
 *     for predictable sequences (mirrors the OpenAI nudge so model
 *     behaviour is consistent across providers).
 */

const ANTHROPIC_COMPUTER_INSTRUCTIONS = `You control a 1920x1080 cloud browser through the built-in \`computer\` tool. The tool returns a fresh screenshot after every action so you can verify the result before planning the next step.

Action conventions:
- Coordinates are pixels in [x, y] form, top-left origin.
- Use \`screenshot\` first when you need to see the current state.
- Use \`left_click\` for navigation and \`double_click\` for opening files / selecting words.
- Use \`type\` to enter text into a focused field; click first to focus.
- Use \`key\` for individual keys or combos like "Return", "ctrl+l", "alt+Left".
- Use \`scroll\` with \`coordinate\`, \`scroll_direction\`, and \`scroll_amount\` (in clicks/lines).
- Use \`left_click_drag\` between two coordinates for drag-and-drop.
- Use \`wait\` (seconds) to let UI settle after asynchronous changes.

Verification pattern: after multi-step changes, take a screenshot and explicitly
confirm what you see ("I see X, so step Y succeeded") before continuing. Do not
assume an action worked just because you sent it.

To navigate by URL, focus the address bar with key="ctrl+l", then type the URL,
then press key="Return".`;

const ANTHROPIC_BATCH_INSTRUCTIONS = `You also have a \`batch_computer_actions\` tool that bundles multiple actions
into a single call (with optional inline url() and screenshot() reads).
PREFER \`batch_computer_actions\` over the built-in \`computer\` tool for
predictable sequences such as:
- Clicking a text field, typing text, and pressing Enter
- Typing a URL and pressing Enter (use the \`goto\` action — the cua
  extension that focuses the address bar, types, and presses Enter)
- Using \`back\` / \`forward\` (cua extensions for keyboard back/forward)
- Reading the current URL via \`url\` (returns the address-bar value)

When unsure between \`computer\` and \`batch_computer_actions\`, prefer the
batch tool — it is one round-trip and produces predictable read order.`;

export interface AnthropicSystemPromptOptions {
	/** Set false to omit the batch nudge (e.g. when batch is disabled). Defaults to true. */
	includeBatchNudge?: boolean;
}

/** Build the Anthropic-flavored CUA system preamble. */
export function buildAnthropicSystemPrompt(opts: AnthropicSystemPromptOptions = {}): string {
	if (opts.includeBatchNudge === false) return ANTHROPIC_COMPUTER_INSTRUCTIONS;
	return `${ANTHROPIC_COMPUTER_INSTRUCTIONS}\n\n${ANTHROPIC_BATCH_INSTRUCTIONS}`;
}

export const ANTHROPIC_INSTRUCTIONS_RAW = {
	computer: ANTHROPIC_COMPUTER_INSTRUCTIONS,
	batch: ANTHROPIC_BATCH_INSTRUCTIONS,
};
