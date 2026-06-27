import {
	Type,
	type Api,
	type AssistantMessage,
	type Message,
	type Model,
	type SimpleStreamOptions,
	type Static,
	type TSchema,
	type Tool,
} from "@earendil-works/pi-ai";
import type { CuaModelRef, CuaProvider } from "../models";

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

/**
 * Mouse buttons accepted by click, mouse_down, and mouse_up actions. The
 * executor coerces anything outside this set to "left".
 */
export type CuaMouseButton = "left" | "right" | "middle" | "back" | "forward";

/**
 * Mouse buttons accepted by drag actions. The executor coerces anything
 * outside this set to "left".
 */
export type CuaDragMouseButton = "left" | "right" | "middle";

export interface CuaActionClick {
	type: "click";
	x: number;
	y: number;
	button?: CuaMouseButton;
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
	button?: CuaMouseButton;
	hold_keys?: string[];
}

export interface CuaActionMouseUp {
	type: "mouse_up";
	x: number;
	y: number;
	button?: CuaMouseButton;
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
	button?: CuaDragMouseButton;
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

export const CuaPlaywrightSchema = Type.Object(
	{
		code: Type.String({
			description:
				"Playwright/TypeScript to run against the live browser. `page`, `context`, and `browser` are in scope; end with a `return` to send a JSON-serializable value back. Example: \"await page.goto('https://example.com'); return await page.title();\"",
		}),
		timeout_sec: Type.Optional(Type.Number({ description: "Optional execution timeout in seconds. Default 60, max 300." })),
	},
	{ additionalProperties: false },
);

export interface CuaBatchInput {
	actions: CuaAction[];
}
export type CuaNavigationInput = Static<typeof CuaNavigationSchema>;
export type CuaPlaywrightInput = Static<typeof CuaPlaywrightSchema>;

/** Tool schema plus execution adapter for a browser computer-use tool. */
export interface CuaToolExecutorSpec {
	/** Tool schema installed by CuaAgent/CuaAgentHarness. The name must match the provider tool call name. */
	definition: Tool;
	/** Convert that tool's arguments into canonical CUA actions for browser execution. */
	toActions(args: unknown): CuaAction[];
}

/**
 * Default name for batch computer-action tools created by
 * {@link createCuaBatchToolDefinition} and the name Anthropic's batch tool
 * ships under (the only provider that includes one by default).
 */
export const CUA_BATCH_TOOL_NAME = "computer_batch";
export const CUA_NAVIGATION_TOOL_NAME = "computer_use_extra";
export const CUA_PLAYWRIGHT_TOOL_NAME = "playwright_execute";

export const CUA_BATCH_TOOL_DESCRIPTION = [
	"Execute multiple computer actions in sequence, including ordered read steps like url(), cursor_position(), and screenshot().",
	"Prefer this tool for predictable browser interaction sequences such as click-then-type, typing a URL, keyboard navigation, drag paths, and mixed write/read batches.",
	"If no explicit read step is included, the tool returns one fresh screenshot after execution.",
].join("\n");

export const CUA_NAVIGATION_TOOL_DESCRIPTION = "High-level browser navigation helpers for goto, back, forward, and url.";

export const CUA_PLAYWRIGHT_TOOL_DESCRIPTION = [
	"Run Playwright/TypeScript directly against the live browser session for steps that are awkward as raw pointer/keyboard actions: precise DOM reads, form fills, data extraction, and waiting on selectors.",
	"`page`, `context`, and `browser` are in scope and the code may `return` a JSON-serializable value, which comes back as the result.",
	"Each call runs in a fresh JS context — local variables do not persist across calls, but the browser session does (navigation, cookies, DOM state carry over via `page`/`context`/`browser`).",
	"No screenshot is returned automatically; request one with a follow-up screenshot action when you need to see the page, rather than calling page.screenshot() inside the code.",
].join("\n");

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

/** Build execution adapters for individual canonical CUA action tools. */
export function createCuaActionToolExecutors(actions: readonly CuaActionType[] = CUA_ACTION_TYPES): CuaToolExecutorSpec[] {
	return createCuaActionToolDefinitions(actions).map((definition) => {
		const actionType = definition.name as CuaActionType;
		return {
			definition,
			toActions(args: unknown): CuaAction[] {
				return [{ ...(args && typeof args === "object" ? args : {}), type: actionType } as CuaAction];
			},
		};
	});
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

export function createCuaBatchToolDefinition(
	actions?: readonly CuaActionType[],
	options: { name?: string; description?: string } = {},
): Tool {
	return {
		name: options.name ?? CUA_BATCH_TOOL_NAME,
		description: options.description ?? CUA_BATCH_TOOL_DESCRIPTION,
		parameters: createCuaBatchSchema(actions),
	};
}

/** Build an execution adapter for a batch tool whose input is `{ actions }`. */
export function createCuaBatchToolExecutor(
	actions?: readonly CuaActionType[],
	options: { name?: string; description?: string } = {},
): CuaToolExecutorSpec {
	const definition = createCuaBatchToolDefinition(actions, options);
	return {
		definition,
		toActions(args: unknown): CuaAction[] {
			if (!isBatchInput(args)) throw new Error("invalid batch tool parameters");
			return args.actions;
		},
	};
}

/** Build the provider's default CUA tool execution adapters. */
export function computerToolExecutors(options: ComputerToolsOptions = {}): CuaToolExecutorSpec[] {
	return createCuaActionToolExecutors(options.actions);
}

function isBatchInput(value: unknown): value is CuaBatchInput {
	return Boolean(value && typeof value === "object" && Array.isArray((value as { actions?: unknown }).actions));
}

export function createCuaNavigationToolDefinition(): Tool {
	return {
		name: CUA_NAVIGATION_TOOL_NAME,
		description: CUA_NAVIGATION_TOOL_DESCRIPTION,
		parameters: CuaNavigationSchema,
	};
}

export function createCuaPlaywrightToolDefinition(): Tool {
	return {
		name: CUA_PLAYWRIGHT_TOOL_NAME,
		description: CUA_PLAYWRIGHT_TOOL_DESCRIPTION,
		parameters: CuaPlaywrightSchema,
	};
}

export interface CuaScreenshotTransformSpec {
	width: number;
	height: number;
	format: "png" | "jpeg" | "webp";
	quality?: number;
}

export interface CuaScreenshotSpec {
	/** Append a provider-prepared screenshot to the latest user/tool message before each request. */
	appendToLatestMessage?: boolean;
	/** Optional image transform applied to Kernel screenshots before they are sent to the provider. */
	transform?: CuaScreenshotTransformSpec;
}

export interface CuaPayloadContext {
	/** Tool names that should remain in the outbound provider payload even if the provider strips local CUA executors. */
	keepToolNames?: readonly string[];
	/** Capture a fresh browser screenshot, already transformed per the provider's screenshot spec. */
	getScreenshot?: () => Promise<{ data: Buffer; mimeType: string }>;
}

export type CuaPayloadHook = (payload: unknown, model: Model<Api>, context?: CuaPayloadContext) => unknown | Promise<unknown>;

/**
 * pi-ai `SimpleStreamOptions` plus the CUA extension consumed by the
 * Yutori/Tzafon stream adapters. Pass `keepToolNames` for caller tools that
 * must survive provider-native tool-set substitution.
 */
export interface CuaSimpleStreamOptions extends SimpleStreamOptions {
	keepToolNames?: readonly string[];
}

/** Environment variable that disables server-side `previous_response_id` threading when truthy. */
export const CUA_DISABLE_RESPONSE_THREADING_ENV_VAR = "CUA_DISABLE_RESPONSE_THREADING";

/** Per-call control over `previous_response_id` threading for Responses API providers. */
export interface ResponseThreadingOptions {
	/** Force full-history replay for this request, overriding the environment default. */
	disableResponseThreading?: boolean;
}

/**
 * Whether a Responses API provider should thread requests with
 * `previous_response_id` + delta input instead of replaying the full message
 * history. Threading is on by default and disabled by an explicit option or a
 * truthy {@link CUA_DISABLE_RESPONSE_THREADING_ENV_VAR}.
 */
export function responseThreadingEnabled(options?: ResponseThreadingOptions): boolean {
	if (options?.disableResponseThreading) return false;
	const flag = process.env[CUA_DISABLE_RESPONSE_THREADING_ENV_VAR];
	return !(flag && flag !== "0" && flag.toLowerCase() !== "false");
}

/** Result of {@link responseThreadingDelta}: the chaining id and the messages to send this turn. */
export interface ResponseThreadingDelta {
	/** Most recent assistant `responseId`, or undefined when no prior turn carries one. */
	previousResponseId?: string;
	/** Messages to send: those after the latest assistant `responseId`, or all messages when none. */
	deltaMessages: Message[];
}

/**
 * Derive the `previous_response_id` continuation from a message history.
 *
 * Scans for the most recent assistant message carrying a `responseId` and
 * returns it alongside the messages that follow it (the turn's delta). When no
 * assistant message carries a `responseId`, returns every message and no id.
 */
export function responseThreadingDelta(messages: readonly Message[]): ResponseThreadingDelta {
	for (let index = messages.length - 1; index >= 0; index -= 1) {
		const message = messages[index]!;
		if (message.role === "assistant" && (message as AssistantMessage).responseId) {
			return { previousResponseId: (message as AssistantMessage).responseId, deltaMessages: messages.slice(index + 1) };
		}
	}
	return { deltaMessages: [...messages] };
}

/**
 * Runtime configuration for a supported CUA model.
 *
 * Use this to pair a model with the agent tool definitions, baseline prompt,
 * coordinate convention, screenshot policy, and request payload middleware
 * expected by its provider.
 */
export interface CuaRuntimeSpec {
	model: Model<Api>;
	provider: CuaProvider;
	/** Provider-facing CUA tool definitions used for model requests. */
	toolDefinitions: Tool[];
	/** Local execution adapters that turn provider tool calls into canonical CUA actions. */
	toolExecutors: CuaToolExecutorSpec[];
	/** Provider-tuned baseline prompt for browser control behavior. */
	defaultSystemPrompt: string;
	/** Coordinate convention emitted by provider tool calls. */
	coordinateSystem: ComputerToolCoordinateSystem;
	/** Optional provider screenshot input policy used by CuaAgent/CuaAgentHarness. */
	screenshot?: CuaScreenshotSpec;
	/** Optional provider middleware for request payload adaptation. */
	onPayload?: CuaPayloadHook;
}

export type CuaRuntimeSpecInput = CuaModelRef | Model<Api>;

/** Uniform provider contract resolved by the CUA runtime registry. */
export interface CuaProviderModule {
	/** Model-facing CUA tool definitions sent in provider requests. */
	toolDefinitions(options?: ComputerToolsOptions): Tool[];
	/** Local execution adapters (provider tool-call name -> canonical CUA actions). */
	toolExecutors(options?: ComputerToolsOptions): CuaToolExecutorSpec[];
	/** Coordinate convention emitted by this provider's tool calls. */
	coordinateSystem(): ComputerToolCoordinateSystem;
	/** Provider-tuned baseline browser-control system prompt. */
	buildSystemPrompt(opts?: { suffix?: string }): string;
	/** Optional request-payload middleware for provider protocol quirks. */
	onPayload?: CuaPayloadHook;
	/** Optional provider screenshot input policy. */
	screenshot?: CuaScreenshotSpec;
}
