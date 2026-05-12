import type { ComputerTranslator, ComputerUseToolResult, ModelAction } from "@onkernel/cua-translator";
import { type Static, Type } from "@sinclair/typebox";
import { ANTHROPIC_CUA_EXTRA_ACTION_TYPES } from "./cua-extras";
import { ANTHROPIC_OFFICIAL_ACTION_TYPES } from "./official";

const COORD_PAIR = Type.Object({ x: Type.Number(), y: Type.Number() }, { additionalProperties: false });

const Action = Type.Object(
	{
		type: Type.String({
			description: "Action type",
			enum: [
				"click",
				"double_click",
				"triple_click",
				"type",
				"keypress",
				"scroll",
				"move",
				"drag",
				"wait",
				"goto",
				"back",
				"forward",
				"url",
				"screenshot",
			],
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
			Type.Array(COORD_PAIR, {
				description: "Required when type is drag. At least two points.",
			}),
		),
	},
	{ additionalProperties: false },
);

export const AnthropicBatchSchema = Type.Object({
	actions: Type.Array(Action, { description: "Ordered list of actions to execute" }),
});

export type AnthropicBatchToolInput = Static<typeof AnthropicBatchSchema>;

export interface AnthropicBatchToolDetails {
	statusText: string;
	actionDescriptions: string[];
	readResults: Array<{ type: "url"; url: string } | { type: "screenshot"; bytes: number } | { type: "cursor_position"; x: number; y: number }>;
	error?: string;
}

const SETTLE_MS_AFTER_BATCH = 300;

function delay(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

export const ANTHROPIC_BATCH_DESCRIPTION = [
	"Execute multiple computer actions in sequence, including ordered read steps like url() and screenshot() anywhere in the batch.",
	"Coordinates use {x, y} pixels. Modifier keys go in the optional `hold_keys` array on click/scroll/move actions.",
	"Consecutive write actions are flushed together; each url()/screenshot() step returns output in the order it was requested.",
	"If no explicit read step is included, the tool returns one fresh screenshot after execution.",
	"",
	"PREFER this over the built-in `computer` tool when:",
	"- Typing text followed by pressing Enter",
	"- Clicking a field and then typing into it",
	"- Navigating with goto (cua extension that focuses the address bar, types the URL, presses Enter)",
	"- Using back/forward (cua extensions for keyboard back/forward)",
	"- Reading the current URL via url() — returns the address bar contents",
	"",
	"Drag format: when type is drag, include path as an ordered array of {x, y} points (at least two).",
	"If a drag is likely to change the position or layout of other targets, do not batch multiple drags together.",
	"Wait format: when type is wait, you may include ms to control the pause duration in milliseconds.",
].join("\n");

export const ANTHROPIC_BATCH_TOOL_NAME = "batch_computer_actions";

/**
 * Anthropic Messages API `tools[]` entry for the batch tool, in the exact
 * shape Anthropic expects.
 */
export const ANTHROPIC_BATCH_TOOL_WIRE_SPEC = {
	name: ANTHROPIC_BATCH_TOOL_NAME,
	description: ANTHROPIC_BATCH_DESCRIPTION,
	input_schema: AnthropicBatchSchema,
} as const;

/**
 * Re-exported for documentation. The action `type` enum on the wire is the
 * union of official Anthropic computer actions that fit the canonical shape
 * plus the cua extension actions.
 */
export const ANTHROPIC_BATCH_ACTION_TYPES = [
	"click",
	"double_click",
	"triple_click",
	"type",
	"keypress",
	"scroll",
	"move",
	"drag",
	"wait",
	"screenshot",
	...ANTHROPIC_CUA_EXTRA_ACTION_TYPES,
] as const;

export async function executeAnthropicBatch(
	translator: ComputerTranslator,
	params: AnthropicBatchToolInput,
): Promise<ComputerUseToolResult<AnthropicBatchToolDetails>> {
	const rawActions = (params.actions ?? []) as ModelAction[];
	const actions = expandTripleClick(rawActions);
	const actionDescriptions = rawActions.map(describeShort);
	const content: ComputerUseToolResult<AnthropicBatchToolDetails>["content"] = [];
	let statusText: string;
	let execErr: Error | undefined;
	const readResults: AnthropicBatchToolDetails["readResults"] = [];

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

	const details: AnthropicBatchToolDetails = {
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
		case "double_click":
		case "triple_click":
			return `${t}(${num(action.x)}, ${num(action.y)})`;
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

// triple_click handling at translator boundary:
// translator's translateToBatchAction doesn't natively accept "triple_click",
// so map it to three sequential clicks before passing in.
export function expandTripleClick(actions: ModelAction[]): ModelAction[] {
	const expanded: ModelAction[] = [];
	for (const a of actions) {
		if (typeof a.type === "string" && a.type === "triple_click") {
			const x = num(a.x);
			const y = num(a.y);
			expanded.push(
				{ type: "click", x, y, button: "left" },
				{ type: "click", x, y, button: "left" },
				{ type: "click", x, y, button: "left" },
			);
		} else {
			expanded.push(a);
		}
	}
	return expanded;
}
