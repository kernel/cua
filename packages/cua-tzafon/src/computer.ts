import type {
	ComputerTranslator,
	ComputerUseToolResult,
	ModelAction,
} from "@onkernel/cua-translator";
import { type Static, Type } from "@sinclair/typebox";
import { denormalizeX, denormalizeY } from "./coords";
import {
	DEFAULT_TZAFON_SCREEN_SIZE,
	TzafonAction,
	type TzafonScreenSize,
} from "./official";

const SCREENSHOT_DELAY_MS = 500;
const SCROLL_WHEEL_TICKS_PER_NOTCH = 120;

function delay(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface TzafonComputerToolsOptions {
	screenSize?: TzafonScreenSize;
	attachScreenshot?: boolean;
}

export interface TzafonToolDetails {
	action: string;
	statusText: string;
	result?: string;
	error?: string;
}

interface RunContext {
	translator: ComputerTranslator;
	screen: TzafonScreenSize;
	attachScreenshot: boolean;
}

type ToolSchema = ReturnType<typeof Type.Object>;

interface TzafonDefinition<S extends ToolSchema = ToolSchema> {
	name: TzafonAction;
	description: string;
	parameters: S;
	usesCoordinates?: boolean;
	exec: (params: Static<S>, ctx: RunContext) => Promise<{ actions: ModelAction[]; result?: string; done?: boolean }>;
}

const GridPoint = {
	x: Type.Union([Type.Integer({ description: "X in 0-999 grid." }), Type.String({ description: "X in 0-999 grid." })]),
	y: Type.Union([Type.Integer({ description: "Y in 0-999 grid." }), Type.String({ description: "Y in 0-999 grid." })]),
} as const;

const ClickSchema = Type.Object(
	{
		...GridPoint,
		button: Type.Optional(Type.String({ enum: ["left", "right"] })),
	},
	{ additionalProperties: false },
);
const DoubleClickSchema = Type.Object({ ...GridPoint }, { additionalProperties: false });
const PointAndTypeSchema = Type.Object(
	{
		...GridPoint,
		text: Type.String(),
		press_enter: Type.Optional(Type.Boolean({ description: "Press Enter after typing." })),
	},
	{ additionalProperties: false },
);
const KeySchema = Type.Object(
	{
		keys: Type.String({ description: "Key or key combo, for example Enter, ctrl+a, or Tab." }),
	},
	{ additionalProperties: false },
);
const ScrollSchema = Type.Object(
	{
		...GridPoint,
		dy: Type.Integer({ description: "Scroll notches. Positive scrolls down, negative scrolls up." }),
	},
	{ additionalProperties: false },
);
const DragSchema = Type.Object(
	{
		x1: Type.Union([Type.Integer({ description: "Start X in 0-999 grid." }), Type.String()]),
		y1: Type.Union([Type.Integer({ description: "Start Y in 0-999 grid." }), Type.String()]),
		x2: Type.Union([Type.Integer({ description: "End X in 0-999 grid." }), Type.String()]),
		y2: Type.Union([Type.Integer({ description: "End Y in 0-999 grid." }), Type.String()]),
	},
	{ additionalProperties: false },
);
const DoneSchema = Type.Object(
	{
		result: Type.String({ description: "Summary of what was found or accomplished." }),
	},
	{ additionalProperties: false },
);

const TZAFON_DEFINITIONS: TzafonDefinition[] = [
	{
		name: TzafonAction.CLICK,
		description: "Single click at (x, y) in 0-999 grid.",
		parameters: ClickSchema,
		usesCoordinates: true,
		async exec(params, ctx) {
			return {
				actions: [
					{
						type: "click",
						x: denormalizeX(params.x, ctx.screen),
						y: denormalizeY(params.y, ctx.screen),
						button: params.button ?? "left",
					},
				],
			};
		},
	},
	{
		name: TzafonAction.DOUBLE_CLICK,
		description: "Double click at (x, y) in 0-999 grid.",
		parameters: DoubleClickSchema,
		usesCoordinates: true,
		async exec(params, ctx) {
			return {
				actions: [
					{
						type: "double_click",
						x: denormalizeX(params.x, ctx.screen),
						y: denormalizeY(params.y, ctx.screen),
					},
				],
			};
		},
	},
	{
		name: TzafonAction.POINT_AND_TYPE,
		description: "Click at position then type text. For input fields, search bars, address bars.",
		parameters: PointAndTypeSchema,
		usesCoordinates: true,
		async exec(params, ctx) {
			const x = denormalizeX(params.x, ctx.screen);
			const y = denormalizeY(params.y, ctx.screen);
			const actions: ModelAction[] = [
				{ type: "click", x, y, button: "left" },
				{ type: "wait", ms: 300 },
				{ type: "type", text: params.text },
			];
			if (params.press_enter) {
				actions.push({ type: "wait", ms: 100 }, { type: "keypress", keys: ["Return"] });
			}
			return { actions };
		},
	},
	{
		name: TzafonAction.KEY,
		description: "Press key combo (e.g. 'Enter', 'ctrl+a', 'Tab').",
		parameters: KeySchema,
		async exec(params) {
			return {
				actions: [{ type: "keypress", keys: splitKeyCombo(String(params.keys ?? "")) }],
			};
		},
	},
	{
		name: TzafonAction.SCROLL,
		description: "Scroll at (x, y) in 0-999 grid. Positive dy = down, negative = up.",
		parameters: ScrollSchema,
		usesCoordinates: true,
		async exec(params, ctx) {
			const rawDy = typeof params.dy === "number" ? params.dy : Number(params.dy ?? 0);
			const dy = Math.max(-10, Math.min(10, Number.isFinite(rawDy) ? rawDy : 0));
			return {
				actions: [
					{
						type: "scroll",
						x: denormalizeX(params.x, ctx.screen),
						y: denormalizeY(params.y, ctx.screen),
						scroll_x: 0,
						scroll_y: dy * SCROLL_WHEEL_TICKS_PER_NOTCH,
					},
				],
			};
		},
	},
	{
		name: TzafonAction.DRAG,
		description: "Drag from (x1, y1) to (x2, y2) in 0-999 grid.",
		parameters: DragSchema,
		usesCoordinates: true,
		async exec(params, ctx) {
			return {
				actions: [
					{
						type: "drag",
						path: [
							{ x: denormalizeX(params.x1, ctx.screen), y: denormalizeY(params.y1, ctx.screen) },
							{ x: denormalizeX(params.x2, ctx.screen), y: denormalizeY(params.y2, ctx.screen) },
						],
					},
				],
			};
		},
	},
	{
		name: TzafonAction.DONE,
		description: "Task complete. Report findings.",
		parameters: DoneSchema,
		async exec(params) {
			return { actions: [], result: String(params.result ?? ""), done: true };
		},
	},
];

export const TZAFON_FUNCTION_TOOLS = TZAFON_DEFINITIONS.map((definition) => ({
	type: "function" as const,
	name: definition.name,
	description: definition.description,
	parameters: definition.parameters,
}));

export async function executeTzafonFunctionCall(args: {
	translator: ComputerTranslator;
	name: string;
	input: Record<string, unknown>;
	options?: TzafonComputerToolsOptions;
}): Promise<ComputerUseToolResult<TzafonToolDetails>> {
	const definition = TZAFON_DEFINITIONS.find((entry) => entry.name === args.name);
	if (!definition) {
		return {
			content: [{ type: "text", text: `failed: unknown Tzafon function "${args.name}"` }],
			details: {
				action: args.name,
				statusText: `failed: unknown Tzafon function "${args.name}"`,
				error: `unknown Tzafon function "${args.name}"`,
			},
			isError: true,
		};
	}
	const ctx: RunContext = {
		translator: args.translator,
		screen: args.options?.screenSize ?? await currentScreenSize(args.translator, definition.usesCoordinates === true),
		attachScreenshot: args.options?.attachScreenshot !== false,
	};
	return executeDefinition(definition, args.input, ctx);
}

export function getTzafonDefinition(name: string): TzafonDefinition | undefined {
	return TZAFON_DEFINITIONS.find((entry) => entry.name === name);
}

export function splitKeyCombo(keys: string): string[] {
	return keys
		.split("+")
		.map((part) => mapKey(part.trim()))
		.filter(Boolean);
}

async function executeDefinition(
	definition: TzafonDefinition,
	params: Record<string, unknown>,
	ctx: RunContext,
): Promise<ComputerUseToolResult<TzafonToolDetails>> {
	const content: ComputerUseToolResult<TzafonToolDetails>["content"] = [];
	let statusText = "ok";
	let resultText: string | undefined;
	let execErr: Error | undefined;
	let skipScreenshot = false;

	try {
		const { actions, result, done } = await definition.exec(params as never, ctx);
		resultText = result;
		if (done) {
			skipScreenshot = true;
			statusText = result ? `done: ${result}` : "done";
		} else if (actions.length === 0) {
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

	const details: TzafonToolDetails = {
		action: definition.name,
		statusText,
		...(resultText ? { result: resultText } : {}),
		...(execErr ? { error: execErr.message } : {}),
	};

	return {
		content,
		details,
		...(execErr ? { isError: true } : {}),
	};
}

const KEY_MAP: Record<string, string> = {
	return: "Return",
	enter: "Return",
	space: "space",
	tab: "Tab",
	backspace: "BackSpace",
	delete: "Delete",
	escape: "Escape",
	esc: "Escape",
	insert: "Insert",
	up: "Up",
	down: "Down",
	left: "Left",
	right: "Right",
	home: "Home",
	end: "End",
	pageup: "Page_Up",
	page_up: "Page_Up",
	pagedown: "Page_Down",
	page_down: "Page_Down",
};

const MODIFIER_MAP: Record<string, string> = {
	ctrl: "ctrl",
	control: "ctrl",
	alt: "alt",
	shift: "shift",
	meta: "super",
	cmd: "super",
	command: "super",
	win: "super",
};

for (let i = 1; i <= 12; i++) {
	KEY_MAP[`f${i}`] = `F${i}`;
}

function mapKey(key: string): string {
	const normalized = key.toLowerCase();
	return MODIFIER_MAP[normalized] ?? KEY_MAP[normalized] ?? key;
}

async function currentScreenSize(translator: ComputerTranslator, needed: boolean): Promise<TzafonScreenSize> {
	if (!needed) return DEFAULT_TZAFON_SCREEN_SIZE;
	try {
		const png = await translator.screenshotRaw();
		return readPngSize(png) ?? DEFAULT_TZAFON_SCREEN_SIZE;
	} catch {
		return DEFAULT_TZAFON_SCREEN_SIZE;
	}
}

function readPngSize(buf: Buffer): TzafonScreenSize | undefined {
	if (buf.length < 24) return undefined;
	const signature = "89504e470d0a1a0a";
	if (buf.subarray(0, 8).toString("hex") !== signature) return undefined;
	const width = buf.readUInt32BE(16);
	const height = buf.readUInt32BE(20);
	if (width <= 0 || height <= 0) return undefined;
	return { width, height };
}
