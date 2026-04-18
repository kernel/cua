/**
 * Official OpenAI gpt-5.4 computer-use action set.
 *
 * Source of truth: OpenAI's "Computer Use (gpt-5.4)" docs.
 *   https://platform.openai.com/docs/guides/tools-computer-use
 *   https://platform.openai.com/docs/api-reference/responses/object#tools-computer
 *
 * The Responses-API-native `{type:"computer"}` tool emits `computer_call`
 * items shaped like `{action: {type:"click", x, y, ...}, ...}`. We do NOT
 * register that native tool today (pi-ai's stock OpenAI Responses parser
 * does not surface `computer_call` items via SSE). Instead we ship the
 * exact same action vocabulary as a custom function tool
 * (`batch_computer_actions`) that any model can call.
 *
 * The nine actions OpenAI documents are:
 *   click, double_click, scroll, type, wait, keypress, drag, move, screenshot
 * Each click/scroll-style action also accepts an optional `keys` modifier
 * array (modifier keys held during the action — e.g. shift for range
 * select).
 */

import { type Static, Type } from "@sinclair/typebox";

/**
 * The action `type` enum field on every gpt-5.4 computer action. All nine
 * actions are documented at the URLs above.
 */
export const OPENAI_OFFICIAL_ACTION_TYPES = [
	"click",
	"double_click",
	"scroll",
	"type",
	"wait",
	"keypress",
	"drag",
	"move",
	"screenshot",
] as const;

export type OpenAIOfficialActionType = (typeof OPENAI_OFFICIAL_ACTION_TYPES)[number];

/** Modifier keys held during click/scroll/etc. Optional. */
export const OpenAIHoldKeysSchema = Type.Optional(
	Type.Array(Type.String(), {
		description: "Modifier keys to hold during this action (e.g. ['shift'] for range select).",
	}),
);

/** Single point shape used by drag paths. */
export const OpenAIPointSchema = Type.Object(
	{ x: Type.Number(), y: Type.Number() },
	{ additionalProperties: false },
);
export type OpenAIPoint = Static<typeof OpenAIPointSchema>;

/**
 * Schema for ONE official OpenAI gpt-5.4 computer action. Used as one
 * member of the `batch_computer_actions.actions[]` array in our custom
 * function tool. The fields are a superset of all per-action fields the
 * native `computer` tool defines, gated by the `type` discriminator at
 * runtime.
 */
export const OpenAIOfficialActionSchema = Type.Object(
	{
		type: Type.String({
			description: "Official OpenAI computer-use action.",
			enum: [...OPENAI_OFFICIAL_ACTION_TYPES],
		}),
		x: Type.Optional(Type.Number({ description: "Pixel x for click/double_click/scroll/move." })),
		y: Type.Optional(Type.Number({ description: "Pixel y for click/double_click/scroll/move." })),
		button: Type.Optional(
			Type.String({
				description: "Mouse button for click. Defaults to 'left'.",
				enum: ["left", "right", "middle", "back", "forward"],
			}),
		),
		text: Type.Optional(Type.String({ description: "Text to type when type='type'." })),
		keys: Type.Optional(
			Type.Array(Type.String(), {
				description:
					"Keys to press for type='keypress'. The right-most non-modifier becomes the primary key, the rest are modifiers.",
			}),
		),
		hold_keys: OpenAIHoldKeysSchema,
		scroll_x: Type.Optional(Type.Number({ description: "Horizontal scroll delta in pixels (~120 per wheel tick)." })),
		scroll_y: Type.Optional(Type.Number({ description: "Vertical scroll delta in pixels (~120 per wheel tick)." })),
		ms: Type.Optional(Type.Number({ description: "Wait duration in milliseconds when type='wait'." })),
		path: Type.Optional(
			Type.Array(OpenAIPointSchema, {
				description: "Required when type='drag'. Two or more points defining the drag path.",
			}),
		),
	},
	{ additionalProperties: false },
);

export type OpenAIOfficialAction = Static<typeof OpenAIOfficialActionSchema>;
