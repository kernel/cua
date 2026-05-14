import { Type, type Static, type TSchema, type Tool } from "@earendil-works/pi-ai";

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

export type CuaActionType = (typeof CUA_ACTION_TYPES)[number];

export interface CuaActionClick {
	type: "click";
	x: number;
	y: number;
	button?: string;
	hold_keys?: string[];
}

export interface CuaActionDoubleClick {
	type: "double_click";
	x: number;
	y: number;
	hold_keys?: string[];
}

export interface CuaActionMouseDown {
	type: "mouse_down";
	x: number;
	y: number;
	button?: string;
	hold_keys?: string[];
}

export interface CuaActionMouseUp {
	type: "mouse_up";
	x: number;
	y: number;
	button?: string;
	hold_keys?: string[];
}

export interface CuaActionTypeText {
	type: "type";
	text: string;
}

export interface CuaActionKeypress {
	type: "keypress";
	keys: string[];
	duration?: number;
}

export interface CuaActionScroll {
	type: "scroll";
	x?: number;
	y?: number;
	scroll_x?: number;
	scroll_y?: number;
	hold_keys?: string[];
}

export interface CuaActionMove {
	type: "move";
	x: number;
	y: number;
}

export interface CuaActionDrag {
	type: "drag";
	path: Array<{ x: number; y: number }>;
	button?: string;
	hold_keys?: string[];
}

export interface CuaActionWait {
	type: "wait";
	ms?: number;
}

export interface CuaActionScreenshot {
	type: "screenshot";
}

export interface CuaActionGoto {
	type: "goto";
	url: string;
}

export interface CuaActionBack {
	type: "back";
}

export interface CuaActionForward {
	type: "forward";
}

export interface CuaActionUrl {
	type: "url";
}

export interface CuaActionCursorPosition {
	type: "cursor_position";
}

export type CuaAction =
	| CuaActionClick
	| CuaActionDoubleClick
	| CuaActionMouseDown
	| CuaActionMouseUp
	| CuaActionTypeText
	| CuaActionKeypress
	| CuaActionScroll
	| CuaActionMove
	| CuaActionDrag
	| CuaActionWait
	| CuaActionScreenshot
	| CuaActionGoto
	| CuaActionBack
	| CuaActionForward
	| CuaActionUrl
	| CuaActionCursorPosition;

const PointSchema = Type.Object(
	{
		x: Type.Number(),
		y: Type.Number(),
	},
	{ additionalProperties: false },
);

const CUA_ACTION_SCHEMA_BY_TYPE = {
	click: Type.Object(
		{
			type: Type.Literal("click"),
			x: Type.Number(),
			y: Type.Number(),
			button: Type.Optional(Type.String()),
			hold_keys: Type.Optional(Type.Array(Type.String())),
		},
		{ additionalProperties: false },
	),
	double_click: Type.Object(
		{
			type: Type.Literal("double_click"),
			x: Type.Number(),
			y: Type.Number(),
			hold_keys: Type.Optional(Type.Array(Type.String())),
		},
		{ additionalProperties: false },
	),
	mouse_down: Type.Object(
		{
			type: Type.Literal("mouse_down"),
			x: Type.Number(),
			y: Type.Number(),
			button: Type.Optional(Type.String()),
			hold_keys: Type.Optional(Type.Array(Type.String())),
		},
		{ additionalProperties: false },
	),
	mouse_up: Type.Object(
		{
			type: Type.Literal("mouse_up"),
			x: Type.Number(),
			y: Type.Number(),
			button: Type.Optional(Type.String()),
			hold_keys: Type.Optional(Type.Array(Type.String())),
		},
		{ additionalProperties: false },
	),
	type: Type.Object(
		{
			type: Type.Literal("type"),
			text: Type.String(),
		},
		{ additionalProperties: false },
	),
	keypress: Type.Object(
		{
			type: Type.Literal("keypress"),
			keys: Type.Array(Type.String()),
			duration: Type.Optional(Type.Number()),
		},
		{ additionalProperties: false },
	),
	scroll: Type.Object(
		{
			type: Type.Literal("scroll"),
			x: Type.Optional(Type.Number()),
			y: Type.Optional(Type.Number()),
			scroll_x: Type.Optional(Type.Number()),
			scroll_y: Type.Optional(Type.Number()),
			hold_keys: Type.Optional(Type.Array(Type.String())),
		},
		{ additionalProperties: false },
	),
	move: Type.Object(
		{
			type: Type.Literal("move"),
			x: Type.Number(),
			y: Type.Number(),
		},
		{ additionalProperties: false },
	),
	drag: Type.Object(
		{
			type: Type.Literal("drag"),
			path: Type.Array(PointSchema, { minItems: 2 }),
			button: Type.Optional(Type.String()),
			hold_keys: Type.Optional(Type.Array(Type.String())),
		},
		{ additionalProperties: false },
	),
	wait: Type.Object(
		{
			type: Type.Literal("wait"),
			ms: Type.Optional(Type.Number()),
		},
		{ additionalProperties: false },
	),
	screenshot: Type.Object({ type: Type.Literal("screenshot") }, { additionalProperties: false }),
	goto: Type.Object(
		{
			type: Type.Literal("goto"),
			url: Type.String(),
		},
		{ additionalProperties: false },
	),
	back: Type.Object({ type: Type.Literal("back") }, { additionalProperties: false }),
	forward: Type.Object({ type: Type.Literal("forward") }, { additionalProperties: false }),
	url: Type.Object({ type: Type.Literal("url") }, { additionalProperties: false }),
	cursor_position: Type.Object({ type: Type.Literal("cursor_position") }, { additionalProperties: false }),
} satisfies Record<CuaActionType, TSchema>;

type ObjectSchemaWithProperties = TSchema & { properties: Record<string, TSchema> };

function createCuaActionArgumentSchema(action: CuaActionType): TSchema {
	const { type: _type, ...properties } = (CUA_ACTION_SCHEMA_BY_TYPE[action] as ObjectSchemaWithProperties).properties;
	return Type.Object(properties, { additionalProperties: false });
}

export function createCuaActionSchema(actions: readonly CuaActionType[] = CUA_ACTION_TYPES): TSchema {
	if (actions.length === 0) throw new Error("actions must include at least one CUA action type");
	if (actions.length === 1) return CUA_ACTION_SCHEMA_BY_TYPE[actions[0]!];
	return Type.Union(actions.map((action) => CUA_ACTION_SCHEMA_BY_TYPE[action]));
}

export function createCuaActionToolDefinitions(actions: readonly CuaActionType[] = CUA_ACTION_TYPES): Tool[] {
	return actions.map((action) => ({
		name: action,
		description: `Execute one ${action} computer action.`,
		parameters: createCuaActionArgumentSchema(action),
	}));
}

export const CuaActionSchema = createCuaActionSchema();

export function createCuaBatchSchema(actions?: readonly CuaActionType[]): TSchema {
	return Type.Object({
		actions: Type.Array(createCuaActionSchema(actions), { description: "Ordered computer actions to execute." }),
	});
}

export const CuaBatchSchema = createCuaBatchSchema();

export const CuaNavigationSchema = Type.Object(
	{
		action: Type.Union([Type.Literal("goto"), Type.Literal("back"), Type.Literal("forward"), Type.Literal("url")]),
		url: Type.Optional(Type.String()),
	},
	{ additionalProperties: false },
);

export interface CuaBatchInput {
	actions: CuaAction[];
}
export type CuaNavigationInput = Static<typeof CuaNavigationSchema>;

export const CUA_BATCH_TOOL_NAME = "batch_computer_actions";
export const CUA_NAVIGATION_TOOL_NAME = "computer_use_extra";

export const CUA_BATCH_TOOL_DESCRIPTION = [
	"Execute multiple computer actions in sequence, including ordered read steps like url(), cursor_position(), and screenshot().",
	"Prefer this tool for predictable browser interaction sequences such as click-then-type, typing a URL, keyboard navigation, drag paths, and mixed write/read batches.",
	"If no explicit read step is included, the tool returns one fresh screenshot after execution.",
].join("\n");

export const CUA_NAVIGATION_TOOL_DESCRIPTION = "High-level browser navigation helpers for goto, back, forward, and url.";

export interface ComputerToolsOptions {
	actions?: readonly CuaActionType[];
}

export type ComputerToolCoordinateSystem =
	| {
			type: "pixel";
		}
	| {
			type: "normalized";
			range: readonly [number, number];
		};

/**
 * Build the provider's CUA computer-use tools.
 *
 * Use this when calling `complete()` or `stream()` directly and you need an
 * array of `Tool` objects for browser actions. Pass `actions` to expose only a
 * smaller set, such as `["click"]`.
 */
export function computerTools(options: ComputerToolsOptions = {}): Tool[] {
	return createCuaActionToolDefinitions(options.actions);
}

/** Return the canonical tool name that should execute a normalized CUA action. */
export function canonicalToolCallName(action: CuaAction): CuaActionType {
	return action.type;
}

/** Convert a normalized CUA action into tool-call arguments by removing its `type` tag. */
export function canonicalToolCallArguments(action: CuaAction): Record<string, unknown> {
	const { type: _type, ...args } = action as CuaAction & Record<string, unknown>;
	return args;
}

/** Prefix bare hostnames/paths with `https://` before browser navigation. */
export function normalizeGotoUrl(value: unknown): string | undefined {
	if (typeof value !== "string") return undefined;
	const url = value.trim();
	if (!url) return undefined;
	return /^[a-z][a-z0-9+.-]*:\/\//i.test(url) ? url : `https://${url}`;
}

export function createCuaBatchToolDefinition(actions?: readonly CuaActionType[]): Tool {
	return {
		name: CUA_BATCH_TOOL_NAME,
		description: CUA_BATCH_TOOL_DESCRIPTION,
		parameters: createCuaBatchSchema(actions),
	};
}

export function createCuaNavigationToolDefinition(): Tool {
	return {
		name: CUA_NAVIGATION_TOOL_NAME,
		description: CUA_NAVIGATION_TOOL_DESCRIPTION,
		parameters: CuaNavigationSchema,
	};
}
