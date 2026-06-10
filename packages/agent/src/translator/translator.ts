import type Kernel from "@onkernel/sdk";
import type { BrowserCreateResponse, BrowserRetrieveResponse } from "@onkernel/sdk/resources/browsers";
import { normalizeGotoUrl, type ComputerToolCoordinateSystem, type CuaScreenshotSpec } from "@onkernel/cua-ai";
import sharp from "sharp";
import { isKernelModifierKey, normalizeKernelKey, normalizeKernelKeyCombo } from "./keys.js";
import type { BatchExecutionResult, ModelAction } from "./types.js";

export type KernelBrowser = BrowserCreateResponse | BrowserRetrieveResponse;

export interface InternalComputerTranslatorOptions {
	browser: KernelBrowser;
	client: Kernel;
	coordinateSystem?: ComputerToolCoordinateSystem;
	screenshot?: CuaScreenshotSpec;
}

export class InternalComputerTranslator {
	private readonly sessionId: string;
	private readonly client: Kernel;
	private readonly coordinateSystem: ComputerToolCoordinateSystem;
	private readonly screenshotSpec?: CuaScreenshotSpec;
	private readonly viewport: { width: number; height: number };

	constructor(opts: InternalComputerTranslatorOptions) {
		this.sessionId = opts.browser.session_id;
		this.client = opts.client;
		this.coordinateSystem = opts.coordinateSystem ?? { type: "pixel" };
		this.screenshotSpec = opts.screenshot;
		this.viewport = opts.browser.viewport ?? { width: 1920, height: 1080 };
	}

	async screenshotRaw(): Promise<Buffer> {
		return (await this.screenshot()).data;
	}

	async screenshot(): Promise<{ data: Buffer; mimeType: string }> {
		const response = await this.client.browsers.computer.captureScreenshot(this.sessionId, {});
		let data: Buffer<ArrayBufferLike> = Buffer.from(await response.arrayBuffer());
		let mimeType = "image/png";
		const transform = this.screenshotSpec?.transform;
		if (transform) {
			let pipeline = sharp(data).resize(transform.width, transform.height, { fit: "fill" });
			if (transform.format === "webp") {
				pipeline = pipeline.webp({ quality: transform.quality });
				mimeType = "image/webp";
			} else if (transform.format === "jpeg") {
				pipeline = pipeline.jpeg({ quality: transform.quality });
				mimeType = "image/jpeg";
			} else {
				pipeline = pipeline.png();
				mimeType = "image/png";
			}
			data = await pipeline.toBuffer();
		}
		return { data, mimeType };
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
				result.readResults.push({ type: "screenshot", ...(await this.screenshot()) });
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
				const url = normalizeGotoUrl(action.url) ?? "";
				pending.push(
					keypress(["Control", "l"]),
					{ type: "type_text", type_text: { text: url } },
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
			pending.push(toSdkAction(type, action, this.coordinateSystem, this.viewport));
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

function toSdkAction(
	type: string,
	action: ModelAction,
	coordinateSystem: ComputerToolCoordinateSystem,
	viewport: { width: number; height: number },
): KernelBatchAction {
	switch (type) {
		case "click": {
			const clickHoldKeys = readHoldKeys(action.hold_keys);
			const point = toViewportPoint(action, coordinateSystem, viewport);
			return {
				type: "click_mouse",
				click_mouse: {
					x: point.x,
					y: point.y,
					button: clickMouseButtonOr(action.button, "left"),
					...(clickHoldKeys.length > 0 ? { hold_keys: clickHoldKeys } : {}),
				},
			};
		}
		case "double_click": {
			const doubleClickHoldKeys = readHoldKeys(action.hold_keys);
			const point = toViewportPoint(action, coordinateSystem, viewport);
			return {
				type: "click_mouse",
				click_mouse: {
					x: point.x,
					y: point.y,
					num_clicks: 2,
					...(doubleClickHoldKeys.length > 0 ? { hold_keys: doubleClickHoldKeys } : {}),
				},
			};
		}
		case "mouse_down":
		case "mouse_up": {
			const mouseHoldKeys = readHoldKeys(action.hold_keys);
			const point = toViewportPoint(action, coordinateSystem, viewport);
			return {
				type: "click_mouse",
				click_mouse: {
					x: point.x,
					y: point.y,
					button: clickMouseButtonOr(action.button, "left"),
					click_type: type === "mouse_down" ? "down" : "up",
					...(mouseHoldKeys.length > 0 ? { hold_keys: mouseHoldKeys } : {}),
				},
			};
		}
		case "type":
			return { type: "type_text", type_text: { text: typeof action.text === "string" ? action.text : "" } };
		case "keypress":
			return keypress(toStringArray(action.keys), action.duration);
		case "scroll": {
			const scrollHoldKeys = readHoldKeys(action.hold_keys);
			const point = toViewportPoint(action, coordinateSystem, viewport);
			return {
				type: "scroll",
				scroll: {
					x: point.x,
					y: point.y,
					delta_x: toInt(action.scroll_x),
					delta_y: toInt(action.scroll_y),
					...(scrollHoldKeys.length > 0 ? { hold_keys: scrollHoldKeys } : {}),
				},
			};
		}
		case "move": {
			const moveHoldKeys = readHoldKeys(action.hold_keys);
			const point = toViewportPoint(action, coordinateSystem, viewport);
			return {
				type: "move_mouse",
				move_mouse: {
					x: point.x,
					y: point.y,
					...(moveHoldKeys.length > 0 ? { hold_keys: moveHoldKeys } : {}),
				},
			};
		}
		case "drag": {
			const dragHoldKeys = readHoldKeys(action.hold_keys);
			return {
				type: "drag_mouse",
				drag_mouse: {
					path: toPath(action.path, coordinateSystem, viewport),
					button: dragMouseButtonOr(action.button, "left"),
					...(dragHoldKeys.length > 0 ? { hold_keys: dragHoldKeys } : {}),
				},
			};
		}
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

function readHoldKeys(value: unknown): string[] {
	return toStringArray(value).map(normalizeKernelKey);
}

function keypress(keys: string[], duration: unknown = undefined): KernelBatchAction {
	const translated = keys.flatMap(normalizeKernelKeyCombo);
	const pressedKeys = translated.filter((key) => !isKernelModifierKey(key));
	const holdKeys = pressedKeys.length > 0 ? translated.filter(isKernelModifierKey) : translated.slice(0, -1);
	return {
		type: "press_key",
		press_key: {
			keys: pressedKeys.length > 0 ? pressedKeys : translated.slice(-1),
			...(holdKeys.length > 0 ? { hold_keys: holdKeys } : {}),
			...(typeof duration === "number" && Number.isFinite(duration) && duration > 0 ? { duration: Math.trunc(duration) } : {}),
		},
	};
}

function toPath(
	value: unknown,
	coordinateSystem: ComputerToolCoordinateSystem = { type: "pixel" },
	viewport: { width: number; height: number } = { width: 1920, height: 1080 },
): Array<[number, number]> {
	if (!Array.isArray(value)) return [];
	return value.map((point) => toPathPoint(point, coordinateSystem, viewport));
}

function toPathPoint(value: unknown, coordinateSystem: ComputerToolCoordinateSystem, viewport: { width: number; height: number }): [number, number] {
	if (Array.isArray(value)) {
		const point = transformPoint(toInt(value[0]), toInt(value[1]), coordinateSystem, viewport);
		return [point.x, point.y];
	}
	if (value && typeof value === "object") {
		const point = value as Record<string, unknown>;
		const transformed = transformPoint(toInt(point.x), toInt(point.y), coordinateSystem, viewport);
		return [transformed.x, transformed.y];
	}
	return [0, 0];
}

function toViewportPoint(
	action: Record<string, unknown>,
	coordinateSystem: ComputerToolCoordinateSystem,
	viewport: { width: number; height: number },
): { x: number; y: number } {
	return transformPoint(toInt(action.x), toInt(action.y), coordinateSystem, viewport);
}

function transformPoint(
	x: number,
	y: number,
	coordinateSystem: ComputerToolCoordinateSystem,
	viewport: { width: number; height: number },
): { x: number; y: number } {
	if (coordinateSystem.type === "pixel") return { x, y };
	const [min, max] = coordinateSystem.range;
	const scale = max - min;
	if (scale <= 0) return { x, y };
	return {
		x: clamp(Math.round(((x - min) / scale) * viewport.width), 0, viewport.width - 1),
		y: clamp(Math.round(((y - min) / scale) * viewport.height), 0, viewport.height - 1),
	};
}

function clamp(value: number, min: number, max: number): number {
	return Math.max(min, Math.min(max, value));
}
