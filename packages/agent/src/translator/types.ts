export type ModelAction = Record<string, unknown>;

export type BatchActionType =
	| "click_mouse"
	| "move_mouse"
	| "type_text"
	| "press_key"
	| "scroll"
	| "drag_mouse"
	| "sleep";

export interface BatchAction {
	type: BatchActionType;
	click_mouse?: Record<string, unknown>;
	move_mouse?: Record<string, unknown>;
	type_text?: Record<string, unknown>;
	press_key?: Record<string, unknown>;
	scroll?: Record<string, unknown>;
	drag_mouse?: Record<string, unknown>;
	sleep?: Record<string, unknown>;
}

export type BatchReadResult =
	| { type: "screenshot"; pngBytes: Buffer }
	| { type: "url"; url: string }
	| { type: "cursor_position"; x: number; y: number };

export interface BatchExecutionResult {
	readResults: BatchReadResult[];
}

export interface ComputerUseToolResult<TDetails = unknown> {
	content: Array<{ type: "text"; text: string } | { type: "image"; data: string; mimeType: string }>;
	details: TDetails;
	isError?: boolean;
}
