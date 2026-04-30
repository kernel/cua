import {
	type ComputerTranslator,
	type ComputerUseToolResult,
	type ModelAction,
	backModelAction,
} from "@onkernel/cua-translator";
import { type TObject, Type } from "@sinclair/typebox";
import { denormalizeX, denormalizeY } from "./coords.js";
import {
	DEFAULT_YUTORI_SCREEN_SIZE,
	YutoriAction,
	type YutoriScreenSize,
	type YutoriScrollDirection,
} from "./official.js";

const SCREENSHOT_DELAY_MS = 300;
const WAIT_MS = 2000;
const SCROLL_UNIT_SCREEN_FRACTION = 0.1;

export interface YutoriComputerToolsOptions {
	screenSize?: YutoriScreenSize;
	attachScreenshot?: boolean;
}

export interface YutoriToolDetails {
	action: string;
	statusText: string;
	error?: string;
}

interface RunContext {
	translator: ComputerTranslator;
	screen: YutoriScreenSize;
	attachScreenshot: boolean;
}

interface YutoriDefinition<S extends TObject = TObject> {
	name: YutoriAction;
	description: string;
	parameters: S;
	exec: (params: any, ctx: RunContext) => Promise<ModelAction[]>;
}

const NormalizedPoint = Type.Tuple([
	Type.Number({ description: "X in 0-1000 normalized coordinates." }),
	Type.Number({ description: "Y in 0-1000 normalized coordinates." }),
]);

const PointSchema = Type.Object(
	{
		coordinates: NormalizedPoint,
	},
	{ additionalProperties: false },
);

const ScrollSchema = Type.Object(
	{
		coordinates: NormalizedPoint,
		direction: Type.String({ enum: ["up", "down", "left", "right"] }),
		amount: Type.Integer({ minimum: 1, description: "Scroll units; 1 is roughly 10% of screen height." }),
	},
	{ additionalProperties: false },
);

const TypeSchema = Type.Object(
	{
		text: Type.String(),
		press_enter_after: Type.Optional(Type.Boolean()),
		clear_before_typing: Type.Optional(Type.Boolean()),
	},
	{ additionalProperties: false },
);

const KeyPressSchema = Type.Object(
	{
		key_comb: Type.Optional(Type.String({ description: "Playwright-compatible key or key combination, e.g. Control+c." })),
		key: Type.Optional(Type.String({ description: "n1.5 key alias for key_comb." })),
	},
	{ additionalProperties: false },
);

const DragSchema = Type.Object(
	{
		start_coordinates: NormalizedPoint,
		coordinates: NormalizedPoint,
	},
	{ additionalProperties: false },
);

const EmptySchema = Type.Object({}, { additionalProperties: false });

const GotoUrlSchema = Type.Object(
	{
		url: Type.String({ description: "Fully-qualified URL to navigate to." }),
	},
	{ additionalProperties: false },
);

export const YUTORI_DEFINITIONS: YutoriDefinition[] = [
	{
		name: YutoriAction.LEFT_CLICK,
		description: "Left mouse click at a specific point on the page.",
		parameters: PointSchema,
		async exec({ coordinates }, ctx) {
			const [x, y] = point(coordinates, ctx.screen);
			return [{ type: "click", x, y, button: "left" }];
		},
	},
	{
		name: YutoriAction.DOUBLE_CLICK,
		description: "Double left mouse click at a specific point on the page.",
		parameters: PointSchema,
		async exec({ coordinates }, ctx) {
			const [x, y] = point(coordinates, ctx.screen);
			return [{ type: "double_click", x, y }];
		},
	},
	{
		name: YutoriAction.TRIPLE_CLICK,
		description: "Triple left mouse click at a specific point on the page.",
		parameters: PointSchema,
		async exec({ coordinates }, ctx) {
			const [x, y] = point(coordinates, ctx.screen);
			return [
				{ type: "double_click", x, y },
				{ type: "click", x, y, button: "left" },
			];
		},
	},
	{
		name: YutoriAction.RIGHT_CLICK,
		description: "Right mouse click at a specific point on the page.",
		parameters: PointSchema,
		async exec({ coordinates }, ctx) {
			const [x, y] = point(coordinates, ctx.screen);
			return [{ type: "click", x, y, button: "right" }];
		},
	},
	{
		name: YutoriAction.SCROLL,
		description: "Scrolls the page in a given direction from a point.",
		parameters: ScrollSchema,
		async exec({ coordinates, direction, amount }, ctx) {
			const [x, y] = point(coordinates, ctx.screen);
			const { scroll_x, scroll_y } = scrollDelta(direction, amount, ctx.screen);
			return [{ type: "scroll", x, y, scroll_x, scroll_y }];
		},
	},
	{
		name: YutoriAction.TYPE,
		description: "Types text into the focused input.",
		parameters: TypeSchema,
		async exec(params) {
			const actions: ModelAction[] = [];
			if (params.clear_before_typing) {
				actions.push({ type: "keypress", keys: ["Control", "a"] });
				actions.push({ type: "keypress", keys: ["Backspace"] });
			}
			actions.push({ type: "type", text: params.text });
			if (params.press_enter_after) actions.push({ type: "keypress", keys: ["Enter"] });
			return actions;
		},
	},
	{
		name: YutoriAction.KEY_PRESS,
		description: "Sends a Playwright-compatible keyboard input.",
		parameters: KeyPressSchema,
		async exec({ key_comb, key }) {
			return [{ type: "keypress", keys: splitKeyCombination(key_comb ?? key) }];
		},
	},
	{
		name: YutoriAction.HOVER,
		description: "Hovers over a specific point on the page.",
		parameters: PointSchema,
		async exec({ coordinates }, ctx) {
			const [x, y] = point(coordinates, ctx.screen);
			return [{ type: "move", x, y }];
		},
	},
	{
		name: YutoriAction.DRAG,
		description: "Drags from a start point to a target point.",
		parameters: DragSchema,
		async exec({ start_coordinates, coordinates }, ctx) {
			const [sx, sy] = point(start_coordinates, ctx.screen);
			const [x, y] = point(coordinates, ctx.screen);
			return [{ type: "drag", path: [{ x: sx, y: sy }, { x, y }], button: "left" }];
		},
	},
	{
		name: YutoriAction.WAIT,
		description: "Pauses execution.",
		parameters: EmptySchema,
		async exec() {
			return [{ type: "wait", ms: WAIT_MS }];
		},
	},
	{
		name: YutoriAction.REFRESH,
		description: "Reloads the current page.",
		parameters: EmptySchema,
		async exec() {
			return [{ type: "keypress", keys: ["F5"] }, { type: "wait", ms: WAIT_MS }];
		},
	},
	{
		name: YutoriAction.GO_BACK,
		description: "Navigates back in browser history.",
		parameters: EmptySchema,
		async exec() {
			return [backModelAction(), { type: "wait", ms: 1500 }];
		},
	},
	{
		name: YutoriAction.GOTO_URL,
		description: "Navigates to a URL.",
		parameters: GotoUrlSchema,
		async exec({ url }) {
			return [{ type: "goto", url }, { type: "wait", ms: 2000 }];
		},
	},
];

export const YUTORI_FUNCTION_DECLARATIONS = YUTORI_DEFINITIONS.map((definition) => ({
	name: definition.name,
	description: definition.description,
	parameters: definition.parameters,
}));

export async function executeYutoriFunctionCall(args: {
	translator: ComputerTranslator;
	name: string;
	input: Record<string, unknown>;
	options?: YutoriComputerToolsOptions;
}): Promise<ComputerUseToolResult<YutoriToolDetails>> {
	const definition = YUTORI_DEFINITIONS.find((entry) => entry.name === args.name);
	if (!definition) {
		const statusText = `failed: unknown Yutori action "${args.name}"`;
		return {
			content: [{ type: "text", text: statusText }],
			details: { action: args.name, statusText, error: statusText },
			isError: true,
		};
	}
	const ctx: RunContext = {
		translator: args.translator,
		screen: args.options?.screenSize ?? DEFAULT_YUTORI_SCREEN_SIZE,
		attachScreenshot: args.options?.attachScreenshot !== false,
	};
	return executeDefinition(definition, args.input, ctx);
}

async function executeDefinition(
	definition: YutoriDefinition,
	params: Record<string, unknown>,
	ctx: RunContext,
): Promise<ComputerUseToolResult<YutoriToolDetails>> {
	const content: ComputerUseToolResult<YutoriToolDetails>["content"] = [];
	let statusText = "ok";
	let execErr: Error | undefined;

	try {
		const actions = await definition.exec(params, ctx);
		await ctx.translator.executeBatch(actions);
	} catch (err) {
		execErr = err instanceof Error ? err : new Error(String(err));
		statusText = `failed: ${execErr.message}`;
	}

	content.push({ type: "text", text: statusText });

	if (!execErr && ctx.attachScreenshot) {
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

	const details: YutoriToolDetails = {
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

function point(value: unknown, screen: YutoriScreenSize): [number, number] {
	if (!Array.isArray(value) || value.length < 2) {
		return [Math.round(screen.width / 2), Math.round(screen.height / 2)];
	}
	return [denormalizeX(Number(value[0]) || 0, screen), denormalizeY(Number(value[1]) || 0, screen)];
}

function scrollDelta(
	direction: YutoriScrollDirection,
	amount: number | undefined,
	screen: YutoriScreenSize,
): { scroll_x: number; scroll_y: number } {
	const px = Math.max(1, Math.trunc(amount ?? 3)) * Math.round(screen.height * SCROLL_UNIT_SCREEN_FRACTION);
	switch (direction) {
		case "up":
			return { scroll_x: 0, scroll_y: -px };
		case "down":
			return { scroll_x: 0, scroll_y: px };
		case "left":
			return { scroll_x: -px, scroll_y: 0 };
		case "right":
			return { scroll_x: px, scroll_y: 0 };
		default:
			throw new Error(`unknown scroll direction: ${direction}`);
	}
}

function splitKeyCombination(value: string | undefined): string[] {
	if (!value) throw new Error("key_comb or key is required for key_press");
	return value
		.split("+")
		.map((part) => part.trim())
		.filter(Boolean);
}

function delay(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
