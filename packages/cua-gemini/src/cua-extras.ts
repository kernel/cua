/**
 * cua extension actions for Gemini.
 *
 * Most navigation verbs Gemini's official action set already covers
 * (`go_back`, `go_forward`, `navigate`, `search`). The only cua-added
 * one we need on top is `url` — read-the-current-URL — because Gemini's
 * predefined actions don't expose it. We surface it via the cua-added
 * `batch_computer_actions` tool's action union, NOT as a standalone
 * Gemini predefined function.
 */

export const GEMINI_CUA_EXTRA_ACTION_TYPES = ["url"] as const;

export type GeminiCuaExtraActionType = (typeof GEMINI_CUA_EXTRA_ACTION_TYPES)[number];
