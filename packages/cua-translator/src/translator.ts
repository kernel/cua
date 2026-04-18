import type Kernel from "@onkernel/sdk";
import {
	backBatchActions,
	currentUrlCopyActions,
	forwardBatchActions,
	gotoBatchActions,
} from "./cua-extras.js";
import { splitKeypress, translateKeys } from "./keysym.js";
import { modelScrollDeltaToWheelTicks } from "./scroll.js";
import {
	type ActionValidationScope,
	ActionValidationError,
	ALLOWED_MODEL_ACTION_TYPES,
	type BatchAction,
	type BatchExecutionResult,
	type ModelAction,
} from "./types.js";

// ─── Numeric helpers ───────────────────────────────────────────────────────

function toInt(v: unknown): number {
	if (typeof v === "number" && Number.isFinite(v)) return Math.trunc(v);
	if (typeof v === "string" && v.trim() !== "") {
		const parsed = Number(v);
		if (Number.isFinite(parsed)) return Math.trunc(parsed);
	}
	return 0;
}

function stringOr(v: unknown, fallback: string): string {
	if (typeof v === "string" && v.length > 0) return v;
	return fallback;
}

function toStringSlice(v: unknown): string[] {
	if (!Array.isArray(v)) return [];
	return v.map((x) => (typeof x === "string" ? x : ""));
}

function readHoldKeys(v: unknown): string[] | undefined {
	if (!Array.isArray(v) || v.length === 0) return undefined;
	const raw = v.filter((k): k is string => typeof k === "string" && k.length > 0);
	if (raw.length === 0) return undefined;
	return translateKeys(raw);
}

function toIntPath(v: unknown): number[][] {
	if (!Array.isArray(v)) return [];
	return v.map((p) => {
		if (Array.isArray(p) && p.length >= 2) {
			return [toInt(p[0]), toInt(p[1])];
		}
		if (p && typeof p === "object") {
			const pt = p as Record<string, unknown>;
			return [toInt(pt.x), toInt(pt.y)];
		}
		return [0, 0];
	});
}

function validateDragPath(path: number[][], idx: number, scope: ActionValidationScope): void {
	if (path.length >= 2) return;
	const reason = `drag action requires path with at least two points; got ${path.length} (${formatPath(path)})`;
	throw new ActionValidationError({
		scope,
		actionType: "drag",
		batchIndex: scope === "batch" ? idx : -1,
		allowed: [...ALLOWED_MODEL_ACTION_TYPES],
		reason,
	});
}

function formatPath(path: number[][]): string {
	if (path.length === 0) return "[]";
	const parts: string[] = [];
	for (let i = 0; i < path.length; i++) {
		if (i >= 4) {
			parts.push("...");
			break;
		}
		const pt = path[i]!;
		if (pt.length < 2) {
			parts.push("<?>");
			continue;
		}
		parts.push(`(${pt[0]},${pt[1]})`);
	}
	return `[${parts.join(" -> ")}]`;
}

function delay(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

const CURRENT_URL_MAX_ATTEMPTS = 3;
const CURRENT_URL_RETRY_DELAY_MS = 120;

// ─── ModelAction → BatchAction ────────────────────────────────────────────

export function translateToBatchAction(actionType: string, action: ModelAction, idx: number): BatchAction {
	switch (actionType) {
		case "click": {
			const holdKeys = readHoldKeys(action.hold_keys);
			return {
				type: "click_mouse",
				clickMouse: {
					x: toInt(action.x),
					y: toInt(action.y),
					button: stringOr(action.button, "left"),
					...(holdKeys ? { holdKeys } : {}),
				},
			};
		}
		case "double_click": {
			const holdKeys = readHoldKeys(action.hold_keys);
			return {
				type: "click_mouse",
				clickMouse: {
					x: toInt(action.x),
					y: toInt(action.y),
					numClicks: 2,
					...(holdKeys ? { holdKeys } : {}),
				},
			};
		}
		case "type":
			return {
				type: "type_text",
				typeText: { text: typeof action.text === "string" ? action.text : "" },
			};
		case "keypress": {
			const { holdKeys, primaryKeys } = splitKeypress(toStringSlice(action.keys));
			return { type: "press_key", pressKey: { keys: primaryKeys, holdKeys } };
		}
		case "scroll": {
			const holdKeys = readHoldKeys(action.hold_keys);
			return {
				type: "scroll",
				scroll: {
					x: toInt(action.x),
					y: toInt(action.y),
					deltaX: modelScrollDeltaToWheelTicks(toInt(action.scroll_x)),
					deltaY: modelScrollDeltaToWheelTicks(toInt(action.scroll_y)),
					...(holdKeys ? { holdKeys } : {}),
				},
			};
		}
		case "move":
			return { type: "move_mouse", moveMouse: { x: toInt(action.x), y: toInt(action.y) } };
		case "drag": {
			const path = toIntPath(action.path);
			validateDragPath(path, idx, "batch");
			return { type: "drag_mouse", dragMouse: { path } };
		}
		case "wait": {
			const ms = typeof action.ms === "number" ? Math.trunc(action.ms) : 1000;
			return { type: "sleep", sleep: { durationMs: ms } };
		}
		default:
			throw new ActionValidationError({
				scope: "batch",
				actionType,
				batchIndex: idx,
				allowed: [...ALLOWED_MODEL_ACTION_TYPES],
			});
	}
}

// ─── SDK conversion ────────────────────────────────────────────────────────

type SdkBatchAction = import("@onkernel/sdk/resources/browsers/computer.js").ComputerBatchParams.Action;

export function toSdkAction(action: BatchAction): SdkBatchAction {
	switch (action.type) {
		case "click_mouse": {
			const op = action.clickMouse!;
			const sdk: SdkBatchAction = {
				type: "click_mouse",
				click_mouse: {
					x: op.x,
					y: op.y,
					...(op.button ? { button: op.button as "left" | "right" | "middle" | "back" | "forward" } : {}),
					...(op.numClicks && op.numClicks > 1 ? { num_clicks: op.numClicks } : {}),
					...(op.holdKeys && op.holdKeys.length ? { hold_keys: op.holdKeys } : {}),
				},
			};
			return sdk;
		}
		case "move_mouse":
			return {
				type: "move_mouse",
				move_mouse: { x: action.moveMouse!.x, y: action.moveMouse!.y },
			};
		case "type_text":
			return {
				type: "type_text",
				type_text: { text: action.typeText!.text },
			};
		case "press_key": {
			const op = action.pressKey!;
			return {
				type: "press_key",
				press_key: {
					keys: op.keys,
					...(op.holdKeys && op.holdKeys.length ? { hold_keys: op.holdKeys } : {}),
				},
			};
		}
		case "scroll": {
			const op = action.scroll!;
			return {
				type: "scroll",
				scroll: {
					x: op.x,
					y: op.y,
					...(op.deltaX !== undefined ? { delta_x: op.deltaX } : {}),
					...(op.deltaY !== undefined ? { delta_y: op.deltaY } : {}),
					...(op.holdKeys && op.holdKeys.length ? { hold_keys: op.holdKeys } : {}),
				},
			};
		}
		case "drag_mouse":
			return {
				type: "drag_mouse",
				drag_mouse: { path: action.dragMouse!.path },
			};
		case "sleep":
			return {
				type: "sleep",
				sleep: { duration_ms: action.sleep!.durationMs },
			};
	}
}

// ─── Translator ────────────────────────────────────────────────────────────

export interface ComputerLogger {
	(label: string): () => void;
}

export interface ComputerTranslatorOptions {
	client: Kernel;
	sessionId: string;
	logger?: ComputerLogger;
}

/**
 * Translates `ModelAction[]` (the canonical OpenAI-style action shape) into
 * Kernel SDK batch calls, with read coalescing for `url` and `screenshot`
 * steps. Provider adapter packages normalize their own action shape to
 * `ModelAction` before calling `executeBatch`.
 */
export class ComputerTranslator {
	private readonly client: Kernel;
	private readonly sessionId: string;
	private readonly logger: ComputerLogger;

	constructor(opts: ComputerTranslatorOptions) {
		this.client = opts.client;
		this.sessionId = opts.sessionId;
		this.logger = opts.logger ?? (() => () => {});
	}

	/** Capture a screenshot, returning the raw PNG bytes. */
	async screenshotRaw(): Promise<Buffer> {
		const done = this.logger("screenshot()");
		try {
			const response = await this.client.browsers.computer.captureScreenshot(this.sessionId, {});
			const ab = await response.arrayBuffer();
			return Buffer.from(ab);
		} finally {
			done();
		}
	}

	/** Capture a screenshot, returning base64-encoded PNG bytes. */
	async screenshotBase64(): Promise<string> {
		const buf = await this.screenshotRaw();
		return buf.toString("base64");
	}

	/** Read the current URL via Ctrl+L → Ctrl+C → readClipboard. */
	async currentUrl(): Promise<string> {
		const done = this.logger("url()");
		try {
			for (let attempt = 0; attempt < CURRENT_URL_MAX_ATTEMPTS; attempt++) {
				await this.runKernelBatch(currentUrlCopyActions());
				if (attempt > 0) {
					await delay(CURRENT_URL_RETRY_DELAY_MS);
				}
				const resp = await this.client.browsers.computer.readClipboard(this.sessionId);
				const url = (resp.text ?? "").trim();
				if (url) return url;
				if (attempt + 1 < CURRENT_URL_MAX_ATTEMPTS) {
					await delay(CURRENT_URL_RETRY_DELAY_MS);
				}
			}
			throw new Error("clipboard URL was empty");
		} finally {
			done();
		}
	}

	/**
	 * Execute a batch of model-level actions against the Kernel browser.
	 *
	 * Coalesces consecutive write actions into a single Kernel batch HTTP
	 * call. Read-style actions (`url`, `screenshot`) flush the pending writes
	 * first, then perform the read. The cua extensions (`goto`, `back`,
	 * `forward`) expand to their canonical batch sequences inline.
	 */
	async executeBatch(actions: ModelAction[]): Promise<BatchExecutionResult> {
		const result: BatchExecutionResult = { readResults: [] };
		let pending: BatchAction[] = [];

		const flush = async (): Promise<void> => {
			if (pending.length === 0) return;
			await this.runKernelBatch(pending);
			pending = [];
		};

		for (let idx = 0; idx < actions.length; idx++) {
			const action = actions[idx]!;
			const actionType = typeof action.type === "string" ? action.type : "";

			switch (actionType) {
				case "goto":
					pending.push(...gotoBatchActions(stringOr(action.url, "")));
					continue;
				case "back":
					pending.push(...backBatchActions());
					continue;
				case "forward":
					pending.push(...forwardBatchActions());
					continue;
				case "screenshot": {
					await flush();
					const png = await this.screenshotRaw();
					result.readResults.push({ type: "screenshot", pngBytes: png });
					continue;
				}
				case "url": {
					await flush();
					const url = await this.currentUrl();
					result.readResults.push({ type: "url", url });
					continue;
				}
			}

			pending.push(translateToBatchAction(actionType, action, idx));
		}

		await flush();
		return result;
	}

	private async runKernelBatch(batch: BatchAction[]): Promise<void> {
		if (batch.length === 0) return;
		const done = this.logger(describeBatch(batch));
		try {
			await this.client.browsers.computer.batch(this.sessionId, {
				actions: batch.map(toSdkAction),
			});
		} finally {
			done();
		}
	}
}

// ─── Describe (for logging) ────────────────────────────────────────────────

export function describeBatch(actions: BatchAction[]): string {
	const parts = actions.map((a) => {
		switch (a.type) {
			case "click_mouse": {
				const op = a.clickMouse!;
				if ((op.numClicks ?? 0) > 1) return `double_click(${op.x},${op.y})`;
				return `click(${op.x},${op.y})`;
			}
			case "type_text": {
				const text = a.typeText!.text;
				const t = text.length > 30 ? `${text.slice(0, 27)}...` : text;
				return `type(${JSON.stringify(t)})`;
			}
			case "press_key": {
				const op = a.pressKey!;
				if (op.holdKeys && op.holdKeys.length > 0) {
					return `key(hold=${JSON.stringify(op.holdKeys)}, keys=${JSON.stringify(op.keys)})`;
				}
				return `key(${JSON.stringify(op.keys)})`;
			}
			case "scroll": {
				const op = a.scroll!;
				return `scroll(${op.x}, ${op.y}, wheel_dx=${op.deltaX ?? 0}, wheel_dy=${op.deltaY ?? 0})`;
			}
			case "move_mouse":
				return "move";
			case "drag_mouse":
				return `drag(points=${a.dragMouse!.path.length}, path=${formatPath(a.dragMouse!.path)})`;
			case "sleep":
				return `sleep(${a.sleep!.durationMs}ms)`;
		}
	});
	return `batch[${parts.join(" → ")}]`;
}

export function describeSingleAction(actionType: string, a: ModelAction): string {
	switch (actionType) {
		case "click": {
			const x = toInt(a.x);
			const y = toInt(a.y);
			const btn = stringOr(a.button, "left");
			return btn === "left" ? `click(${x}, ${y})` : `click(${x}, ${y}, ${btn})`;
		}
		case "double_click":
			return `double_click(${toInt(a.x)}, ${toInt(a.y)})`;
		case "type": {
			const text = typeof a.text === "string" ? a.text : "";
			const t = text.length > 60 ? `${text.slice(0, 57)}...` : text;
			return `type(${JSON.stringify(t)})`;
		}
		case "keypress":
			return `keypress(${JSON.stringify(toStringSlice(a.keys))})`;
		case "scroll":
			return `scroll(${toInt(a.x)}, ${toInt(a.y)}, dx=${toInt(a.scroll_x)}, dy=${toInt(a.scroll_y)})`;
		case "move":
			return `move(${toInt(a.x)}, ${toInt(a.y)})`;
		case "drag":
			return `drag(points=${(toIntPath(a.path) ?? []).length})`;
		case "wait":
			return "wait";
		case "goto":
			return `goto(${JSON.stringify(stringOr(a.url, ""))})`;
		case "back":
			return "back()";
		case "forward":
			return "forward()";
		case "url":
			return "url()";
		case "screenshot":
			return "screenshot()";
		default:
			return actionType;
	}
}

export function describeBatchModel(actions: ModelAction[]): string {
	const parts = actions.map((a) => describeSingleAction(typeof a.type === "string" ? a.type : "", a));
	return `batch[${parts.join(" → ")}]`;
}
