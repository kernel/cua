import type Kernel from "@onkernel/sdk";
import { ComputerTranslator, type ModelAction, translateKeys } from "@onkernel/cua-translator";

const SETTLE_MS = 300;
const DEFAULT_HOLD_KEY_MS = 1000;

export interface MapComputerActionOptions {
	client: Kernel;
	sessionId: string;
}

export type ComputerActionInput = {
	action:
		| "key"
		| "hold_key"
		| "type"
		| "cursor_position"
		| "mouse_move"
		| "left_mouse_down"
		| "left_mouse_up"
		| "left_click"
		| "left_click_drag"
		| "right_click"
		| "middle_click"
		| "double_click"
		| "triple_click"
		| "scroll"
		| "wait"
		| "screenshot"
		| "zoom";
	coordinate?: [number, number];
	duration?: number;
	region?: [number, number, number, number];
	scroll_amount?: number;
	scroll_direction?: "up" | "down" | "left" | "right";
	start_coordinate?: [number, number];
	text?: string;
};

export type ComputerActionResult =
	| { type: "image"; data: string }
	| { type: "text"; text: string };

function delay(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Translate an AI SDK computer use action input to canonical ModelActions
 * that ComputerTranslator understands.
 */
export function translateToModelActions(input: ComputerActionInput): ModelAction[] {
	const { action, coordinate, text } = input;

	switch (action) {
		case "screenshot":
			return [{ type: "screenshot" }];

		case "left_click":
			return [clickAction("left", coordinate)];
		case "right_click":
			return [clickAction("right", coordinate)];
		case "middle_click":
			return [clickAction("middle", coordinate)];

		case "double_click":
			return [{
				type: "double_click",
				...(coordinate ? { x: coordinate[0], y: coordinate[1] } : {}),
			}];

		case "triple_click": {
			const base = coordinate
				? { x: coordinate[0], y: coordinate[1], button: "left" }
				: { button: "left" };
			return [
				{ type: "click", ...base },
				{ type: "click", ...base },
				{ type: "click", ...base },
			];
		}

		case "mouse_move": {
			if (!coordinate) throw new Error("mouse_move requires coordinate");
			return [{ type: "move", x: coordinate[0], y: coordinate[1] }];
		}

		case "left_click_drag": {
			if (!coordinate) throw new Error("left_click_drag requires coordinate");
			const start = input.start_coordinate;
			const firstPoint = start
				? { x: start[0], y: start[1] }
				: { current: true };
			return [{
				type: "drag",
				path: [firstPoint, { x: coordinate[0], y: coordinate[1] }],
			}];
		}

		case "left_mouse_down":
			return [{
				type: "mouse_down",
				button: "left",
				...(coordinate ? { x: coordinate[0], y: coordinate[1] } : {}),
			}];

		case "left_mouse_up":
			return [{
				type: "mouse_up",
				button: "left",
				...(coordinate ? { x: coordinate[0], y: coordinate[1] } : {}),
			}];

		case "type": {
			if (text === undefined) throw new Error("type requires text");
			return [{ type: "type", text }];
		}

		case "key": {
			if (!text) throw new Error("key requires text");
			return [{ type: "keypress", keys: parseKeyCombo(text) }];
		}

		case "hold_key": {
			if (!text) throw new Error("hold_key requires text");
			const durationMs = typeof input.duration === "number"
				? Math.max(0, Math.trunc(input.duration * 1000))
				: DEFAULT_HOLD_KEY_MS;
			return [{ type: "keypress", keys: parseKeyCombo(text), duration_ms: durationMs }];
		}

		case "scroll": {
			const direction = input.scroll_direction ?? "down";
			const amount = input.scroll_amount ?? 3;
			const magnitude = Math.max(1, Math.trunc(Math.abs(amount))) * 120;
			let scrollX = 0;
			let scrollY = 0;
			switch (direction) {
				case "up": scrollY = -magnitude; break;
				case "down": scrollY = magnitude; break;
				case "left": scrollX = -magnitude; break;
				case "right": scrollX = magnitude; break;
			}
			return [{
				type: "scroll",
				scroll_x: scrollX,
				scroll_y: scrollY,
				...(coordinate ? { x: coordinate[0], y: coordinate[1] } : {}),
			}];
		}

		case "wait": {
			const duration = typeof input.duration === "number" ? input.duration : 1;
			return [{ type: "wait", ms: Math.max(0, Math.trunc(duration * 1000)) }];
		}

		case "cursor_position":
			return [{ type: "cursor_position" }];

		case "zoom":
			return [];

		default:
			throw new Error(`unsupported computer action: ${action}`);
	}
}

/**
 * Execute a single AI SDK computer use action against a Kernel browser.
 *
 * This is the standalone mapping function — use it when you need to wrap
 * the execution in your own context (e.g. a Temporal Activity).
 */
export async function mapComputerAction(
	opts: MapComputerActionOptions,
	input: ComputerActionInput,
): Promise<ComputerActionResult> {
	const translator = new ComputerTranslator({
		client: opts.client,
		sessionId: opts.sessionId,
	});

	const actions = translateToModelActions(input);

	if (actions.length === 0) {
		const png = await translator.screenshotBase64();
		return { type: "image", data: png };
	}

	const result = await translator.executeBatch(actions);

	for (const read of result.readResults) {
		if (read.type === "screenshot") {
			return { type: "image", data: read.pngBytes.toString("base64") };
		}
		if (read.type === "url") {
			return { type: "text", text: `url: ${read.url}` };
		}
		if (read.type === "cursor_position") {
			return { type: "text", text: `X=${read.x},Y=${read.y}` };
		}
	}

	await delay(SETTLE_MS);
	const png = await translator.screenshotBase64();
	return { type: "image", data: png };
}

function clickAction(
	button: "left" | "right" | "middle",
	coordinate?: [number, number],
): ModelAction {
	return {
		type: "click",
		button,
		...(coordinate ? { x: coordinate[0], y: coordinate[1] } : {}),
	};
}

function parseKeyCombo(text: string): string[] {
	return translateKeys(
		text.split("+").map((s) => s.trim()).filter(Boolean),
	);
}
