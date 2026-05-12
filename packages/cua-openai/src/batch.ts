import type { ComputerTranslator, ComputerUseToolResult, ModelAction } from "@onkernel/cua-translator";
import { type Static, Type } from "@sinclair/typebox";
import { OPENAI_CUA_EXTRA_ACTION_TYPES } from "./cua-extras";
import { OPENAI_OFFICIAL_ACTION_TYPES } from "./official";

export const OPENAI_BATCH_TOOL_NAME = "batch_computer_actions";

export const OPENAI_BATCH_DESCRIPTION = [
	"Execute multiple computer actions in sequence, including ordered read steps like url() and screenshot() anywhere in the batch.",
	"Consecutive write actions are executed together, and each url()/screenshot() step returns output in the same order it was requested.",
	"If no explicit read step is included, the tool returns one fresh screenshot after execution.",
	"",
	"PREFER this over individual computer actions when:",
	"- Typing text followed by pressing Enter",
	"- Clicking a field and then typing into it",
	"- Dragging an item from one location to another using a drag path",
	"- Any sequence where you can plan several steps at once, even if you need occasional url() or screenshot() readbacks between them",
	"",
	"Drag format: when type is drag, include path as an array of at least two points like [{\"x\":120,\"y\":340},{\"x\":520,\"y\":340}] or a longer path for curved movement.",
	"If one drag is likely to change the position, order, or layout of other targets, do not batch multiple drags together; perform one drag, inspect the updated screenshot, then plan the next drag.",
	"Wait format: when type is wait, you may include ms to control the pause duration.",
].join("\n");

const Action = Type.Object(
	{
		type: Type.String({
			description: "Action type",
			enum: [...OPENAI_OFFICIAL_ACTION_TYPES, ...OPENAI_CUA_EXTRA_ACTION_TYPES],
		}),
		x: Type.Optional(Type.Number()),
		y: Type.Optional(Type.Number()),
		text: Type.Optional(Type.String()),
		url: Type.Optional(Type.String({ description: "URL to navigate to when type is goto" })),
		keys: Type.Optional(Type.Array(Type.String())),
		button: Type.Optional(Type.String()),
		hold_keys: Type.Optional(Type.Array(Type.String())),
		scroll_x: Type.Optional(Type.Number()),
		scroll_y: Type.Optional(Type.Number()),
		ms: Type.Optional(Type.Number({ description: "Optional wait duration in milliseconds when type is wait" })),
		path: Type.Optional(
			Type.Array(
				Type.Object(
					{
						x: Type.Number(),
						y: Type.Number(),
					},
					{ additionalProperties: false },
				),
				{
					description:
						"Required when type is drag. Drag path as an ordered array of points with at least two entries.",
				},
			),
		),
	},
	{ additionalProperties: false },
);

export const BatchSchema = Type.Object({
	actions: Type.Array(Action, { description: "Ordered list of actions to execute" }),
});

export type BatchToolInput = Static<typeof BatchSchema>;

export interface BatchToolDetails {
	statusText: string;
	actionDescriptions: string[];
	readResults: Array<{ type: "url"; url: string } | { type: "screenshot"; bytes: number } | { type: "cursor_position"; x: number; y: number }>;
	error?: string;
}

export const OPENAI_BATCH_TOOL = {
	type: "function",
	name: OPENAI_BATCH_TOOL_NAME,
	description: OPENAI_BATCH_DESCRIPTION,
	parameters: BatchSchema,
	strict: false,
} as const;

const SETTLE_MS_AFTER_BATCH = 300;

function delay(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function executeOpenAIBatch(
	translator: ComputerTranslator,
	params: BatchToolInput,
): Promise<ComputerUseToolResult<BatchToolDetails>> {
	const actions = (params.actions ?? []) as ModelAction[];
	const actionDescriptions = actions.map(describeShort);
	const content: ComputerUseToolResult<BatchToolDetails>["content"] = [];
	let statusText: string;
	let execErr: Error | undefined;
	const readResults: BatchToolDetails["readResults"] = [];

	let hasScreenshotInResults = false;
	try {
		const result = await translator.executeBatch(actions);
		for (const r of result.readResults) {
			if (r.type === "url") {
				readResults.push({ type: "url", url: r.url });
			} else if (r.type === "screenshot") {
				readResults.push({ type: "screenshot", bytes: r.pngBytes.length });
				hasScreenshotInResults = true;
			} else {
				readResults.push({ type: "cursor_position", x: r.x, y: r.y });
			}
		}
		statusText = "Actions executed successfully.";
		content.push({ type: "text", text: statusText });
		for (const r of result.readResults) {
			if (r.type === "url") {
				content.push({ type: "text", text: `url(): ${r.url}` });
			} else if (r.type === "screenshot") {
				content.push({
					type: "image",
					data: r.pngBytes.toString("base64"),
					mimeType: "image/png",
				});
			} else {
				content.push({ type: "text", text: `cursor_position(): ${r.x},${r.y}` });
			}
		}
	} catch (err) {
		execErr = err instanceof Error ? err : new Error(String(err));
		statusText = `Actions failed: ${execErr.message}`;
		content.push({ type: "text", text: statusText });
	}

	const needFallback = readResults.length === 0 || (execErr && !hasScreenshotInResults);
	if (needFallback) {
		if (!execErr) await delay(SETTLE_MS_AFTER_BATCH);
		try {
			const png = await translator.screenshotRaw();
			content.push({ type: "image", data: png.toString("base64"), mimeType: "image/png" });
			readResults.push({ type: "screenshot", bytes: png.length });
		} catch (shotErr) {
			content[0] = {
				type: "text",
				text: `${statusText} Screenshot unavailable: ${(shotErr as Error).message}`,
			};
		}
	}

	const details: BatchToolDetails = {
		statusText,
		actionDescriptions,
		readResults,
		...(execErr ? { error: execErr.message } : {}),
	};

	return {
		content,
		details,
		...(execErr ? { isError: true } : {}),
	};
}

function describeShort(action: ModelAction): string {
	const t = typeof action.type === "string" ? action.type : "";
	switch (t) {
		case "click":
			return `click(${num(action.x)}, ${num(action.y)})`;
		case "double_click":
			return `double_click(${num(action.x)}, ${num(action.y)})`;
		case "type": {
			const text = typeof action.text === "string" ? action.text : "";
			const trimmed = text.length > 30 ? `${text.slice(0, 27)}...` : text;
			return `type(${JSON.stringify(trimmed)})`;
		}
		case "keypress": {
			const keys = Array.isArray(action.keys) ? (action.keys as string[]) : [];
			return `keypress(${JSON.stringify(keys)})`;
		}
		case "scroll":
			return `scroll(${num(action.x)}, ${num(action.y)})`;
		case "move":
			return `move(${num(action.x)}, ${num(action.y)})`;
		case "drag":
			return "drag(...)";
		case "wait":
			return "wait";
		case "goto":
			return `goto(${JSON.stringify(typeof action.url === "string" ? action.url : "")})`;
		case "back":
			return "back()";
		case "forward":
			return "forward()";
		case "url":
			return "url()";
		case "screenshot":
			return "screenshot()";
		default:
			return t || "<unknown>";
	}
}

function num(v: unknown): number {
	if (typeof v === "number" && Number.isFinite(v)) return Math.trunc(v);
	return 0;
}
