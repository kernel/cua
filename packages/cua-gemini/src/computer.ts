import type {
	ComputerTranslator,
	ComputerUseToolResult,
	ModelAction,
} from "@onkernel/cua-translator";
import {
	backModelAction,
	forwardModelAction,
} from "@onkernel/cua-translator";
import { type TObject, Type } from "@sinclair/typebox";
import { denormalizeX, denormalizeY } from "./coords.js";
import {
	DEFAULT_GEMINI_SCREEN_SIZE,
	GeminiAction,
	type GeminiScreenSize,
} from "./official.js";

const SCREENSHOT_DELAY_MS = 500;
const PX_PER_NOTCH = 60;
const MAX_NOTCHES_PER_ACTION = 17;

function delay(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface GeminiComputerToolsOptions {
	screenSize?: GeminiScreenSize;
	attachScreenshot?: boolean;
}

export interface GeminiToolDetails {
	action: string;
	statusText: string;
	error?: string;
}

interface RunContext {
	translator: ComputerTranslator;
	screen: GeminiScreenSize;
	attachScreenshot: boolean;
}

interface GeminiDefinition<S extends TObject = TObject> {
	name: GeminiAction;
	description: string;
	parameters: S;
	exec: (params: any, ctx: RunContext) => Promise<ModelAction[]>;
}

const NormalizedXY = {
	x: Type.Number({ description: "X in 0-1000 normalized coords." }),
	y: Type.Number({ description: "Y in 0-1000 normalized coords." }),
} as const;

const OpenWebBrowserSchema = Type.Object({}, { additionalProperties: false });
const ClickAtSchema = Type.Object({ ...NormalizedXY }, { additionalProperties: false });
const HoverAtSchema = Type.Object({ ...NormalizedXY }, { additionalProperties: false });
const TypeTextAtSchema = Type.Object(
	{
		...NormalizedXY,
		text: Type.String({ description: "Text to type after focusing the field at (x, y)." }),
		press_enter: Type.Optional(Type.Boolean({ description: "Press Enter after typing." })),
		clear_before_typing: Type.Optional(
			Type.Boolean({ description: "Select-all + delete before typing. Defaults to true." }),
		),
	},
	{ additionalProperties: false },
);
const ScrollDocumentSchema = Type.Object(
	{
		direction: Type.String({ description: "Scroll direction.", enum: ["up", "down", "left", "right"] }),
		magnitude: Type.Optional(Type.Number({ description: "Scroll magnitude in pixels. Default 400." })),
	},
	{ additionalProperties: false },
);
const ScrollAtSchema = Type.Object(
	{
		...NormalizedXY,
		direction: Type.String({ enum: ["up", "down", "left", "right"] }),
		magnitude: Type.Optional(Type.Number()),
	},
	{ additionalProperties: false },
);
const Wait5SecondsSchema = Type.Object({}, { additionalProperties: false });
const GoBackSchema = Type.Object({}, { additionalProperties: false });
const GoForwardSchema = Type.Object({}, { additionalProperties: false });
const SearchSchema = Type.Object({}, { additionalProperties: false });
const NavigateSchema = Type.Object(
	{
		url: Type.String({ description: "Fully-qualified URL to navigate to." }),
	},
	{ additionalProperties: false },
);
const KeyCombinationSchema = Type.Object(
	{
		keys: Type.String({
			description: "Key combo joined with '+' (e.g. 'ctrl+l', 'shift+Tab', 'Return').",
		}),
	},
	{ additionalProperties: false },
);
const DragAndDropSchema = Type.Object(
	{
		x: Type.Number({ description: "Start X (0-1000)." }),
		y: Type.Number({ description: "Start Y (0-1000)." }),
		destination_x: Type.Number({ description: "End X (0-1000)." }),
		destination_y: Type.Number({ description: "End Y (0-1000)." }),
	},
	{ additionalProperties: false },
);

const GEMINI_DEFINITIONS: GeminiDefinition[] = [
	{
		name: GeminiAction.OPEN_WEB_BROWSER,
		description:
			"Acknowledge that the web browser is already open. Returns a fresh screenshot of the current page.",
		parameters: OpenWebBrowserSchema,
		async exec() {
			return [{ type: "screenshot" }];
		},
	},
	{
		name: GeminiAction.CLICK_AT,
		description: "Left-click at the given (x, y) coordinates (0-1000 normalized).",
		parameters: ClickAtSchema,
		async exec({ x, y }, ctx) {
			return [{ type: "click", x: denormalizeX(x, ctx.screen), y: denormalizeY(y, ctx.screen), button: "left" }];
		},
	},
	{
		name: GeminiAction.HOVER_AT,
		description: "Move the mouse cursor to the given (x, y) coordinates without clicking.",
		parameters: HoverAtSchema,
		async exec({ x, y }, ctx) {
			return [{ type: "move", x: denormalizeX(x, ctx.screen), y: denormalizeY(y, ctx.screen) }];
		},
	},
	{
		name: GeminiAction.TYPE_TEXT_AT,
		description: "Click at (x, y), optionally clear the field, then type text. Optionally press Enter.",
		parameters: TypeTextAtSchema,
		async exec(params, ctx) {
			const px = denormalizeX(params.x, ctx.screen);
			const py = denormalizeY(params.y, ctx.screen);
			const actions: ModelAction[] = [{ type: "click", x: px, y: py, button: "left" }];
			if (params.clear_before_typing !== false) {
				actions.push({ type: "keypress", keys: ["ctrl", "a"] });
			}
			actions.push({ type: "type", text: params.text });
			if (params.press_enter) {
				actions.push({ type: "keypress", keys: ["Return"] });
			}
			return actions;
		},
	},
	{
		name: GeminiAction.SCROLL_DOCUMENT,
		description: "Scroll the document by `magnitude` pixels in `direction`. Anchors at the screen center.",
		parameters: ScrollDocumentSchema,
		async exec({ direction, magnitude }, ctx) {
			const centerX = Math.round(ctx.screen.width / 2);
			const centerY = Math.round(ctx.screen.height / 2);
			const px = scrollMagnitudePx(magnitude);
			const { sx, sy } = directionDelta(direction, px);
			return [{ type: "scroll", x: centerX, y: centerY, scroll_x: sx, scroll_y: sy }];
		},
	},
	{
		name: GeminiAction.SCROLL_AT,
		description: "Scroll at a specific (x, y) location by `magnitude` pixels in `direction`.",
		parameters: ScrollAtSchema,
		async exec({ x, y, direction, magnitude }, ctx) {
			const px = denormalizeX(x, ctx.screen);
			const py = denormalizeY(y, ctx.screen);
			const m = scrollMagnitudePx(magnitude);
			const { sx, sy } = directionDelta(direction, m);
			return [{ type: "scroll", x: px, y: py, scroll_x: sx, scroll_y: sy }];
		},
	},
	{
		name: GeminiAction.WAIT_5_SECONDS,
		description: "Sleep for 5 seconds (e.g. to let the page settle after async navigation).",
		parameters: Wait5SecondsSchema,
		async exec() {
			return [{ type: "wait", ms: 5000 }];
		},
	},
	{
		name: GeminiAction.GO_BACK,
		description: "Navigate back in browser history (Alt+Left).",
		parameters: GoBackSchema,
		async exec() {
			return [backModelAction()];
		},
	},
	{
		name: GeminiAction.GO_FORWARD,
		description: "Navigate forward in browser history (Alt+Right).",
		parameters: GoForwardSchema,
		async exec() {
			return [forwardModelAction()];
		},
	},
	{
		name: GeminiAction.SEARCH,
		description: "Focus the address bar (Ctrl+L).",
		parameters: SearchSchema,
		async exec() {
			return [{ type: "keypress", keys: ["ctrl", "l"] }];
		},
	},
	{
		name: GeminiAction.NAVIGATE,
		description: "Navigate the browser to a fully-qualified URL via the address bar.",
		parameters: NavigateSchema,
		async exec({ url }) {
			return [{ type: "goto", url }];
		},
	},
	{
		name: GeminiAction.KEY_COMBINATION,
		description: "Press a key or key combination joined by '+' (e.g. 'ctrl+l', 'Return', 'shift+Tab').",
		parameters: KeyCombinationSchema,
		async exec({ keys }) {
			return [{ type: "keypress", keys: keys.split("+").map((s: string) => s.trim()).filter(Boolean) }];
		},
	},
	{
		name: GeminiAction.DRAG_AND_DROP,
		description:
			"Drag from (x, y) to (destination_x, destination_y) using a left-button drag. Coordinates are 0-1000.",
		parameters: DragAndDropSchema,
		async exec({ x, y, destination_x, destination_y }, ctx) {
			return [
				{
					type: "drag",
					path: [
						{ x: denormalizeX(x, ctx.screen), y: denormalizeY(y, ctx.screen) },
						{ x: denormalizeX(destination_x, ctx.screen), y: denormalizeY(destination_y, ctx.screen) },
					],
				},
			];
		},
	},
];

export const GEMINI_FUNCTION_DECLARATIONS = GEMINI_DEFINITIONS.map((definition) => ({
	name: definition.name,
	description: definition.description,
	parameters: definition.parameters,
}));

export async function executeGeminiFunctionCall(args: {
	translator: ComputerTranslator;
	name: string;
	input: Record<string, unknown>;
	options?: GeminiComputerToolsOptions;
}): Promise<ComputerUseToolResult<GeminiToolDetails>> {
	const definition = GEMINI_DEFINITIONS.find((entry) => entry.name === args.name);
	if (!definition) {
		return {
			content: [{ type: "text", text: `failed: unknown Gemini function "${args.name}"` }],
			details: {
				action: args.name,
				statusText: `failed: unknown Gemini function "${args.name}"`,
				error: `unknown Gemini function "${args.name}"`,
			},
			isError: true,
		};
	}
	const ctx: RunContext = {
		translator: args.translator,
		screen: args.options?.screenSize ?? DEFAULT_GEMINI_SCREEN_SIZE,
		attachScreenshot: args.options?.attachScreenshot !== false,
	};
	return executeDefinition(definition, args.input, ctx);
}

async function executeDefinition(
	definition: GeminiDefinition,
	params: Record<string, unknown>,
	ctx: RunContext,
): Promise<ComputerUseToolResult<GeminiToolDetails>> {
	const content: ComputerUseToolResult<GeminiToolDetails>["content"] = [];
	let statusText = "ok";
	let execErr: Error | undefined;
	let skipScreenshot = false;

	try {
		const actions = await definition.exec(params, ctx);
		if (actions.length === 0) {
			skipScreenshot = true;
		} else {
			const result = await ctx.translator.executeBatch(actions);
			for (const r of result.readResults) {
				if (r.type === "screenshot") {
					content.push({ type: "text", text: "screenshot:" });
					content.push({
						type: "image",
						data: r.pngBytes.toString("base64"),
						mimeType: "image/png",
					});
					skipScreenshot = true;
				} else if (r.type === "url") {
					content.push({ type: "text", text: `url: ${r.url}` });
				}
			}
		}
	} catch (err) {
		execErr = err instanceof Error ? err : new Error(String(err));
		statusText = `failed: ${execErr.message}`;
	}

	content.unshift({ type: "text", text: statusText });

	if (!execErr && !skipScreenshot && ctx.attachScreenshot) {
		await delay(SCREENSHOT_DELAY_MS);
		try {
			const png = await ctx.translator.screenshotRaw();
			content.push({
				type: "image",
				data: png.toString("base64"),
				mimeType: "image/png",
			});
		} catch (shotErr) {
			content[0] = {
				type: "text",
				text: `${statusText} (screenshot unavailable: ${(shotErr as Error).message})`,
			};
		}
	}

	const details: GeminiToolDetails = {
		action: definition.name,
		statusText,
		...(execErr ? { error: execErr.message } : {}),
	};

	return {
		content,
		details,
		...(execErr ? { isError: true } : {}),
	};
}

function scrollMagnitudePx(magnitude: number | undefined): number {
	const px = magnitude ?? 400;
	const notches = Math.min(MAX_NOTCHES_PER_ACTION, Math.max(1, Math.round(px / PX_PER_NOTCH)));
	return notches * 120;
}

function directionDelta(direction: string, magnitudePx: number): { sx: number; sy: number } {
	switch (direction) {
		case "down":
			return { sx: 0, sy: magnitudePx };
		case "up":
			return { sx: 0, sy: -magnitudePx };
		case "right":
			return { sx: magnitudePx, sy: 0 };
		case "left":
			return { sx: -magnitudePx, sy: 0 };
		default:
			throw new Error(`unknown scroll direction: ${direction}`);
	}
}
