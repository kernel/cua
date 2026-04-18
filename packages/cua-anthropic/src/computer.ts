import type { ComputerTranslator, ComputerUseToolResult, ModelAction } from "@onkernel/cua-translator";
import { type Static, Type } from "@sinclair/typebox";

/**
 * Permissive schema for the built-in Anthropic `computer` tool.
 *
 * Anthropic's `computer` tool is schema-less on the wire (the model knows
 * the action shape internally; we only get `tool_use` blocks named
 * "computer" with arbitrary input).
 */
const Coordinate = Type.Tuple([Type.Number(), Type.Number()]);

export const ComputerSchema = Type.Object(
	{
		action: Type.String({
			description:
				"Anthropic computer action: screenshot, left_click, right_click, middle_click, double_click, triple_click, mouse_move, left_click_drag, type, key, scroll, hold_key, wait, left_mouse_down, left_mouse_up, zoom",
		}),
		coordinate: Type.Optional(Coordinate),
		start_coordinate: Type.Optional(Coordinate),
		text: Type.Optional(Type.String()),
		duration: Type.Optional(Type.Number()),
		scroll_direction: Type.Optional(Type.String()),
		scroll_amount: Type.Optional(Type.Number()),
		region: Type.Optional(
			Type.Tuple([Type.Number(), Type.Number(), Type.Number(), Type.Number()]),
		),
	},
	{ additionalProperties: true },
);

export type AnthropicComputerInput = Static<typeof ComputerSchema>;

export interface AnthropicComputerDetails {
	action: string;
	statusText: string;
	error?: string;
}

const SETTLE_MS = 300;

function delay(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function executeAnthropicComputerAction(
	translator: ComputerTranslator,
	params: AnthropicComputerInput,
): Promise<ComputerUseToolResult<AnthropicComputerDetails>> {
	const action = String(params.action ?? "");
	const content: ComputerUseToolResult<AnthropicComputerDetails>["content"] = [];
	let statusText = "ok";
	let execErr: Error | undefined;
	let skipScreenshot = false;

	try {
		const actions = translateAnthropicAction(action, params);
		if (actions === "unsupported") {
			throw new Error(`computer action "${action}" is not supported by this cua build`);
		}
		if (actions.length === 0) {
			skipScreenshot = true;
		} else {
			const result = await translator.executeBatch(actions);
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

	if (!execErr && !skipScreenshot) {
		await delay(SETTLE_MS);
		try {
			const png = await translator.screenshotRaw();
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

	const details: AnthropicComputerDetails = {
		action,
		statusText,
		...(execErr ? { error: execErr.message } : {}),
	};

	return {
		content,
		details,
		...(execErr ? { isError: true } : {}),
	};
}

type TranslateResult = ModelAction[] | "unsupported";

export function translateAnthropicAction(action: string, params: Record<string, unknown>): TranslateResult {
	switch (action) {
		case "screenshot":
			return [{ type: "screenshot" }];

		case "left_click": {
			const coord = readCoord(params.coordinate);
			if (!coord) throw new Error("left_click requires `coordinate`");
			return modifiedClick("left", coord, params.text);
		}
		case "right_click": {
			const coord = readCoord(params.coordinate);
			if (!coord) throw new Error("right_click requires `coordinate`");
			return modifiedClick("right", coord, params.text);
		}
		case "middle_click": {
			const coord = readCoord(params.coordinate);
			if (!coord) throw new Error("middle_click requires `coordinate`");
			return modifiedClick("middle", coord, params.text);
		}
		case "double_click": {
			const coord = readCoord(params.coordinate);
			if (!coord) throw new Error("double_click requires `coordinate`");
			return [{ type: "double_click", x: coord[0], y: coord[1] }];
		}
		case "triple_click": {
			const coord = readCoord(params.coordinate);
			if (!coord) throw new Error("triple_click requires `coordinate`");
			return [
				{ type: "click", x: coord[0], y: coord[1], button: "left" },
				{ type: "click", x: coord[0], y: coord[1], button: "left" },
				{ type: "click", x: coord[0], y: coord[1], button: "left" },
			];
		}

		case "mouse_move": {
			const coord = readCoord(params.coordinate);
			if (!coord) throw new Error("mouse_move requires `coordinate`");
			return [{ type: "move", x: coord[0], y: coord[1] }];
		}

		case "left_click_drag": {
			const start = readCoord(params.start_coordinate);
			const end = readCoord(params.coordinate);
			if (!start || !end) throw new Error("left_click_drag requires `start_coordinate` and `coordinate`");
			return [
				{
					type: "drag",
					path: [
						{ x: start[0], y: start[1] },
						{ x: end[0], y: end[1] },
					],
				},
			];
		}

		case "type": {
			const text = readString(params.text);
			if (text === undefined) throw new Error("type requires `text`");
			return [{ type: "type", text }];
		}

		case "key": {
			const text = readString(params.text);
			if (!text) throw new Error("key requires `text`");
			return [{ type: "keypress", keys: parseKeyCombo(text) }];
		}

		case "scroll": {
			const coord = readCoord(params.coordinate);
			if (!coord) throw new Error("scroll requires `coordinate`");
			const direction = readString(params.scroll_direction) ?? "down";
			const amount = typeof params.scroll_amount === "number" ? params.scroll_amount : 3;
			const magnitude = Math.max(1, Math.trunc(Math.abs(amount))) * 120;
			let scrollX = 0;
			let scrollY = 0;
			switch (direction) {
				case "up":
					scrollY = -magnitude;
					break;
				case "down":
					scrollY = magnitude;
					break;
				case "left":
					scrollX = -magnitude;
					break;
				case "right":
					scrollX = magnitude;
					break;
				default:
					throw new Error(`scroll: unknown direction "${direction}"`);
			}
			const modifiers = parseModifierList(params.text);
			const modelAction: ModelAction = {
				type: "scroll",
				x: coord[0],
				y: coord[1],
				scroll_x: scrollX,
				scroll_y: scrollY,
				...(modifiers.length > 0 ? { hold_keys: modifiers } : {}),
			};
			return [modelAction];
		}

		case "wait": {
			const duration = typeof params.duration === "number" ? params.duration : 1;
			return [{ type: "wait", ms: Math.max(0, Math.trunc(duration * 1000)) }];
		}

		case "hold_key":
		case "left_mouse_down":
		case "left_mouse_up":
		case "zoom":
		case "cursor_position":
			return "unsupported";

		default:
			throw new Error(`unknown computer action: ${action}`);
	}
}

function readCoord(value: unknown): [number, number] | null {
	if (!Array.isArray(value) || value.length < 2) return null;
	const x = Number(value[0]);
	const y = Number(value[1]);
	if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
	return [Math.trunc(x), Math.trunc(y)];
}

function readString(value: unknown): string | undefined {
	if (typeof value === "string") return value;
	return undefined;
}

function parseKeyCombo(text: string): string[] {
	return text
		.split("+")
		.map((s) => s.trim())
		.filter(Boolean);
}

function parseModifierList(value: unknown): string[] {
	const text = readString(value);
	if (!text) return [];
	return text
		.split("+")
		.map((s) => s.trim())
		.filter(Boolean);
}

function modifiedClick(
	button: "left" | "right" | "middle",
	coord: [number, number],
	modifierText: unknown,
): ModelAction[] {
	const modifiers = parseModifierList(modifierText);
	const click: ModelAction = {
		type: "click",
		x: coord[0],
		y: coord[1],
		button,
		...(modifiers.length > 0 ? { hold_keys: modifiers } : {}),
	};
	return [click];
}
