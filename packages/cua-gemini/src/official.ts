/**
 * Google Gemini Computer Use action set.
 *
 * Source of truth: Google's Gemini Computer Use docs / preview.
 *   https://ai.google.dev/gemini-api/docs/computer-use
 *
 * Gemini's computer-use preview tool exposes a fixed list of "predefined"
 * functions that the model has been trained to call. We register the
 * SAME named functions as ordinary `functionDeclarations` so any current
 * Gemini model (with or without the preview computer-use mode enabled)
 * can call them.
 *
 * Coordinate convention: ALL `x` / `y` arguments are normalized to the
 * 0–1000 range. The model emits 0–1000; the Kernel browser expects pixels.
 * `./coords.ts` does the conversion using the screen size advertised at
 * tool construction time (default 1920×1080 to match Kernel cloud
 * browsers).
 */

export enum GeminiAction {
	OPEN_WEB_BROWSER = "open_web_browser",
	CLICK_AT = "click_at",
	HOVER_AT = "hover_at",
	TYPE_TEXT_AT = "type_text_at",
	SCROLL_DOCUMENT = "scroll_document",
	SCROLL_AT = "scroll_at",
	WAIT_5_SECONDS = "wait_5_seconds",
	GO_BACK = "go_back",
	GO_FORWARD = "go_forward",
	SEARCH = "search",
	NAVIGATE = "navigate",
	KEY_COMBINATION = "key_combination",
	DRAG_AND_DROP = "drag_and_drop",
}

/**
 * The complete list of predefined computer-use function names. Order
 * matches Google's docs.
 */
export const PREDEFINED_COMPUTER_USE_FUNCTIONS: GeminiAction[] = Object.values(GeminiAction);

export type ScrollDirection = "up" | "down" | "left" | "right";

/**
 * The argument bag any of the predefined functions can carry. Each function
 * uses a subset of fields (see `./computer-tool.ts`).
 */
export interface GeminiFunctionArgs {
	x?: number;
	y?: number;
	text?: string;
	press_enter?: boolean;
	clear_before_typing?: boolean;
	direction?: ScrollDirection;
	magnitude?: number;
	url?: string;
	keys?: string;
	destination_x?: number;
	destination_y?: number;
	safety_decision?: {
		decision: string;
		explanation: string;
	};
}

export interface GeminiScreenSize {
	width: number;
	height: number;
}

/** Default Kernel cloud browser viewport. */
export const DEFAULT_GEMINI_SCREEN_SIZE: GeminiScreenSize = {
	width: 1920,
	height: 1080,
};

/** Coordinate normalization scale Gemini uses for `x` / `y` (0–1000). */
export const GEMINI_COORDINATE_SCALE = 1000;
