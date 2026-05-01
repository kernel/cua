import { Type, type Static } from "@sinclair/typebox";

export const CUA_ACTION_TYPES = [
	"click",
	"double_click",
	"mouse_down",
	"mouse_up",
	"type",
	"keypress",
	"scroll",
	"move",
	"drag",
	"wait",
	"screenshot",
	"goto",
	"back",
	"forward",
	"url",
	"cursor_position",
] as const;

export const CuaActionSchema = Type.Object(
	{
		type: Type.String({ enum: [...CUA_ACTION_TYPES] }),
		x: Type.Optional(Type.Number()),
		y: Type.Optional(Type.Number()),
		text: Type.Optional(Type.String()),
		url: Type.Optional(Type.String()),
		keys: Type.Optional(Type.Array(Type.String())),
		button: Type.Optional(Type.String()),
		hold_keys: Type.Optional(Type.Array(Type.String())),
		scroll_x: Type.Optional(Type.Number()),
		scroll_y: Type.Optional(Type.Number()),
		ms: Type.Optional(Type.Number()),
		path: Type.Optional(
			Type.Array(
				Type.Object(
					{
						x: Type.Number(),
						y: Type.Number(),
					},
					{ additionalProperties: false },
				),
			),
		),
	},
	{ additionalProperties: false },
);

export const CuaBatchSchema = Type.Object({
	actions: Type.Array(CuaActionSchema, { description: "Ordered computer actions to execute." }),
});

export const CuaNavigationSchema = Type.Object(
	{
		action: Type.Union([Type.Literal("goto"), Type.Literal("back"), Type.Literal("forward"), Type.Literal("url")]),
		url: Type.Optional(Type.String()),
	},
	{ additionalProperties: false },
);

export type CuaAction = Static<typeof CuaActionSchema>;
export type CuaBatchInput = Static<typeof CuaBatchSchema>;
export type CuaNavigationInput = Static<typeof CuaNavigationSchema>;

export const CUA_BATCH_TOOL_NAME = "batch_computer_actions";
export const CUA_NAVIGATION_TOOL_NAME = "computer_use_extra";

export const CUA_BATCH_TOOL_DESCRIPTION = [
	"Execute multiple computer actions in sequence, including ordered read steps like url(), cursor_position(), and screenshot().",
	"Prefer this tool for predictable browser interaction sequences such as click-then-type, typing a URL, keyboard navigation, drag paths, and mixed write/read batches.",
	"If no explicit read step is included, the tool returns one fresh screenshot after execution.",
].join("\n");

export const CUA_NAVIGATION_TOOL_DESCRIPTION = "High-level browser navigation helpers for goto, back, forward, and url.";
