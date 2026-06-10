export type ModelAction = Record<string, unknown>;

export type BatchReadResult =
	| { type: "screenshot"; data: Buffer; mimeType: string }
	| { type: "url"; url: string }
	| { type: "cursor_position"; x: number; y: number };

export interface BatchExecutionResult {
	readResults: BatchReadResult[];
}
