/**
 * Canonical action types for the @onkernel/cua-translator package.
 *
 * `ModelAction` is the high-level shape any provider adapter normalizes to
 * before handing it to the translator. It happens to mirror the shape that
 * OpenAI's `computer` tool emits today (`{type:"click", x, y, ...}`)
 * because that schema has the broadest action vocabulary, but it is in no
 * way OpenAI-specific — provider packages map their own action shape to it.
 *
 * `BatchAction` is the low-level shape we send to `@onkernel/sdk`'s
 * `browsers.computer.batch` endpoint. The translator handles the conversion.
 */

export type ModelAction = Record<string, unknown>;

export type BatchActionType =
	| "click_mouse"
	| "move_mouse"
	| "type_text"
	| "press_key"
	| "scroll"
	| "drag_mouse"
	| "sleep";

export interface ClickMouseOp {
	x: number;
	y: number;
	button?: string;
	clickType?: "down" | "up" | "click";
	numClicks?: number;
	holdKeys?: string[];
}

export interface MoveMouseOp {
	x: number;
	y: number;
	holdKeys?: string[];
}

export interface TypeTextOp {
	text: string;
}

export interface PressKeyOp {
	keys: string[];
	holdKeys?: string[];
	durationMs?: number;
}

export interface ScrollOp {
	x: number;
	y: number;
	deltaX?: number;
	deltaY?: number;
	holdKeys?: string[];
}

export interface DragMouseOp {
	path: number[][];
	button?: string;
	holdKeys?: string[];
}

export interface SleepOp {
	durationMs: number;
}

export interface BatchAction {
	type: BatchActionType;
	clickMouse?: ClickMouseOp;
	moveMouse?: MoveMouseOp;
	typeText?: TypeTextOp;
	pressKey?: PressKeyOp;
	scroll?: ScrollOp;
	dragMouse?: DragMouseOp;
	sleep?: SleepOp;
}

export type BatchReadType = "screenshot" | "url" | "cursor_position";

export interface ScreenshotReadResult {
	type: "screenshot";
	pngBytes: Buffer;
}

export interface UrlReadResult {
	type: "url";
	url: string;
}

export interface CursorPositionReadResult {
	type: "cursor_position";
	x: number;
	y: number;
}

export type BatchReadResult = ScreenshotReadResult | UrlReadResult | CursorPositionReadResult;

export interface BatchExecutionResult {
	readResults: BatchReadResult[];
}

export type ActionValidationScope = "single" | "batch";

export class ActionValidationError extends Error {
	scope: ActionValidationScope;
	actionType: string;
	batchIndex: number;
	allowed: string[];
	reason?: string;

	constructor(args: {
		scope: ActionValidationScope;
		actionType: string;
		batchIndex: number;
		allowed: string[];
		reason?: string;
	}) {
		super(args.reason || defaultMessage(args.scope, args.actionType));
		this.name = "ActionValidationError";
		this.scope = args.scope;
		this.actionType = args.actionType;
		this.batchIndex = args.batchIndex;
		this.allowed = args.allowed;
		this.reason = args.reason;
	}
}

/**
 * The full canonical set of model action types `ComputerTranslator.executeBatch`
 * understands. Includes both the provider-official primitives (`click`,
 * `double_click`, `type`, `keypress`, `scroll`, `move`, `drag`, `wait`,
 * `screenshot`) and the cua-added extensions (`goto`, `back`, `forward`,
 * `url`, `cursor_position`).
 */
export const ALLOWED_MODEL_ACTION_TYPES = [
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

export type AllowedModelActionType = (typeof ALLOWED_MODEL_ACTION_TYPES)[number];

function defaultMessage(scope: ActionValidationScope, actionType: string): string {
	if (scope === "batch") return `unknown action type for batch: ${actionType}`;
	return `unknown action type: ${actionType}`;
}
