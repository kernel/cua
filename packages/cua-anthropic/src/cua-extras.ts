/**
 * cua extension actions that show up alongside Anthropic's official action
 * set in our `batch_computer_actions` tool. Anthropic's built-in `computer`
 * tool does NOT define a navigation verb (`goto`, `back`, `forward`, `url`)
 * — every computer-use template has to invent its own way to drive the
 * address bar via keyboard chords.
 *
 * We expose them in two places:
 *   1. The `batch_computer_actions` tool (Anthropic-flavored, in
 *      `./batch-tool.ts`) accepts these action names alongside the
 *      official ones.
 *   2. The system prompt nudges the model to prefer them over manual
 *      "click address bar → ctrl+a → type → enter" choreography.
 *
 * To remove these from a deployment, delete this file and trim
 * {@link ANTHROPIC_CUA_EXTRA_ACTION_TYPES} out of `batch-tool.ts`'s
 * input_schema enum.
 */

export const ANTHROPIC_CUA_EXTRA_ACTION_TYPES = ["goto", "back", "forward", "url"] as const;

export type AnthropicCuaExtraActionType = (typeof ANTHROPIC_CUA_EXTRA_ACTION_TYPES)[number];
