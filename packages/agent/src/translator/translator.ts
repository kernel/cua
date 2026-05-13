import type Kernel from "@onkernel/sdk";
import type { BrowserCreateResponse, BrowserRetrieveResponse } from "@onkernel/sdk/resources/browsers";
import type { BatchExecutionResult, ModelAction } from "./types";

export type KernelBrowser = BrowserCreateResponse | BrowserRetrieveResponse;

export interface InternalComputerTranslatorOptions {
	browser: KernelBrowser;
	client: Kernel;
}

export class InternalComputerTranslator {
	private readonly sessionId: string;
	private readonly client: Kernel;

	constructor(opts: InternalComputerTranslatorOptions) {
		this.sessionId = opts.browser.session_id;
		this.client = opts.client;
	}

	async screenshotRaw(): Promise<Buffer> {
		const response = await this.client.browsers.computer.captureScreenshot(this.sessionId, {});
		return Buffer.from(await response.arrayBuffer());
	}

	async currentUrl(): Promise<string> {
		await this.runKernelBatch([
			keypress(["Control", "l"]),
			keypress(["Control", "c"]),
		]);
		const response = await this.client.browsers.computer.readClipboard(this.sessionId);
		return (response.text ?? "").trim();
	}

	async currentMousePosition(): Promise<{ x: number; y: number }> {
		const pos = await this.client.browsers.computer.getMousePosition(this.sessionId);
		return { x: toInt(pos.x), y: toInt(pos.y) };
	}

	async executeBatch(actions: ModelAction[]): Promise<BatchExecutionResult> {
		const result: BatchExecutionResult = { readResults: [] };
		const pending: KernelBatchAction[] = [];

		const flush = async (): Promise<void> => {
			if (pending.length === 0) return;
			await this.runKernelBatch(pending.splice(0));
		};

		for (let i = 0; i < actions.length; i++) {
			const action = actions[i]!;
			const type = typeof action.type === "string" ? action.type : "";
			if (type === "screenshot") {
				await flush();
				result.readResults.push({ type: "screenshot", pngBytes: await this.screenshotRaw() });
				continue;
			}
			if (type === "url") {
				await flush();
				result.readResults.push({ type: "url", url: await this.currentUrl() });
				continue;
			}
			if (type === "cursor_position") {
				await flush();
				const pos = await this.currentMousePosition();
				result.readResults.push({ type: "cursor_position", ...pos });
				continue;
			}
			if (type === "goto") {
				pending.push(
					keypress(["Control", "l"]),
					{ type: "type_text", type_text: { text: stringOr(action.url, "") } },
					keypress(["Enter"]),
				);
				continue;
			}
			if (type === "back") {
				pending.push(keypress(["Alt", "Left"]));
				continue;
			}
			if (type === "forward") {
				pending.push(keypress(["Alt", "Right"]));
				continue;
			}
			pending.push(toSdkAction(type, action));
		}

		await flush();
		return result;
	}

	private async runKernelBatch(actions: KernelBatchAction[]): Promise<void> {
		await this.client.browsers.computer.batch(this.sessionId, { actions });
	}
}

type KernelBatchAction =
	Parameters<Kernel["browsers"]["computer"]["batch"]>[1]["actions"][number];

type ClickMouseButton = "back" | "forward" | "left" | "right" | "middle";
type DragMouseButton = "left" | "right" | "middle";

function toSdkAction(type: string, action: ModelAction): KernelBatchAction {
	switch (type) {
		case "click":
			return {
				type: "click_mouse",
				click_mouse: {
					x: toInt(action.x),
					y: toInt(action.y),
					button: clickMouseButtonOr(action.button, "left"),
				},
			};
		case "double_click":
			return {
				type: "click_mouse",
				click_mouse: {
					x: toInt(action.x),
					y: toInt(action.y),
					num_clicks: 2,
				},
			};
		case "mouse_down":
		case "mouse_up":
			return {
				type: "click_mouse",
				click_mouse: {
					x: toInt(action.x),
					y: toInt(action.y),
					button: clickMouseButtonOr(action.button, "left"),
					click_type: type === "mouse_down" ? "down" : "up",
				},
			};
		case "type":
			return { type: "type_text", type_text: { text: typeof action.text === "string" ? action.text : "" } };
		case "keypress":
			return keypress(toStringArray(action.keys));
		case "scroll":
			return {
				type: "scroll",
				scroll: {
					x: toInt(action.x),
					y: toInt(action.y),
					delta_x: toInt(action.scroll_x),
					delta_y: toInt(action.scroll_y),
				},
			};
		case "move":
			return { type: "move_mouse", move_mouse: { x: toInt(action.x), y: toInt(action.y) } };
		case "drag":
			return { type: "drag_mouse", drag_mouse: { path: toPath(action.path), button: dragMouseButtonOr(action.button, "left") } };
		case "wait":
			return { type: "sleep", sleep: { duration_ms: typeof action.ms === "number" ? Math.trunc(action.ms) : 1000 } };
		default:
			throw new Error(`unknown computer action type: ${type}`);
	}
}

function toInt(value: unknown): number {
	if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value);
	if (typeof value === "string" && value.trim()) {
		const n = Number(value);
		if (Number.isFinite(n)) return Math.trunc(n);
	}
	return 0;
}

function stringOr(value: unknown, fallback: string): string {
	return typeof value === "string" && value.length > 0 ? value : fallback;
}

function clickMouseButtonOr(value: unknown, fallback: ClickMouseButton): ClickMouseButton {
	const candidate = stringOr(value, fallback);
	if (candidate === "left" || candidate === "right" || candidate === "middle" || candidate === "back" || candidate === "forward") {
		return candidate;
	}
	return fallback;
}

function dragMouseButtonOr(value: unknown, fallback: DragMouseButton): DragMouseButton {
	const candidate = stringOr(value, fallback);
	if (candidate === "left" || candidate === "right" || candidate === "middle") {
		return candidate;
	}
	return fallback;
}

function toStringArray(value: unknown): string[] {
	return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function keypress(keys: string[]): KernelBatchAction {
	const translated = translateKeys(keys);
	const pressedKeys = translated.filter((key) => !isModifierKey(key));
	const holdKeys = pressedKeys.length > 0 ? translated.filter(isModifierKey) : translated.slice(0, -1);
	return {
		type: "press_key",
		press_key: {
			keys: pressedKeys.length > 0 ? pressedKeys : translated.slice(-1),
			...(holdKeys.length > 0 ? { hold_keys: holdKeys } : {}),
		},
	};
}

const KEY_ALIASES: Record<string, string> = {
	ctrl: "Control_L",
	control: "Control_L",
	control_l: "Control_L",
	controlleft: "Control_L",
	alt: "Alt_L",
	alt_l: "Alt_L",
	altleft: "Alt_L",
	shift: "Shift_L",
	shift_l: "Shift_L",
	shiftleft: "Shift_L",
	meta: "Super_L",
	super: "Super_L",
	cmd: "Super_L",
	command: "Super_L",
	enter: "Return",
	return: "Return",
	escape: "Escape",
	esc: "Escape",
	backspace: "BackSpace",
	delete: "Delete",
	tab: "Tab",
	space: "space",
	left: "Left",
	right: "Right",
	up: "Up",
	down: "Down",
};

function translateKeys(keys: string[]): string[] {
	return keys.flatMap((key) =>
		key
			.split("+")
			.map((part) => part.trim())
			.filter(Boolean)
			.map((part) => {
				const alias = KEY_ALIASES[part.replace(/[-\s]/g, "_").toLowerCase()];
				if (alias) return alias;
				if (part.length === 1 && part >= "A" && part <= "Z") return part.toLowerCase();
				return part;
			}),
	);
}

function isModifierKey(key: string): boolean {
	return key === "Control_L" || key === "Alt_L" || key === "Shift_L" || key === "Super_L";
}

function toPath(value: unknown): Array<[number, number]> {
	if (!Array.isArray(value)) return [];
	return value.map((point) => toPathPoint(point));
}

function toPathPoint(value: unknown): [number, number] {
	if (Array.isArray(value)) return [toInt(value[0]), toInt(value[1])];
	if (value && typeof value === "object") {
		return [toInt((value as Record<string, unknown>).x), toInt((value as Record<string, unknown>).y)];
	}
	return [0, 0];
}
