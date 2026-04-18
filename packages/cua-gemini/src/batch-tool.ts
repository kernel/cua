import type { AgentTool, AgentToolResult } from "@mariozechner/pi-agent-core";
import type { ImageContent, TextContent } from "@mariozechner/pi-ai";
import { type ComputerTranslator, type ModelAction } from "@onkernel/cua-translator";
import { type Static, Type } from "@sinclair/typebox";

/**
 * Gemini-flavored `batch_computer_actions` tool.
 *
 * Registered alongside the predefined per-action tools (see
 * `./computer-tool.ts`) as one more `functionDeclaration` Gemini can
 * call. Reuses the SAME canonical action union as the OpenAI / Anthropic
 * batch tools, so a single `ComputerTranslator.executeBatch` call
 * services the actions.
 *
 * IMPORTANT: unlike the per-action tools (which use Gemini's 0-1000
 * normalized coordinate convention), this batch tool uses PIXEL
 * coordinates (the canonical translator convention). The system prompt
 * documents this distinction so the model picks the right shape.
 */

const COORD_PAIR = Type.Object({ x: Type.Number(), y: Type.Number() }, { additionalProperties: false });

const Action = Type.Object(
	{
		type: Type.String({
			description: "Action type.",
			enum: [
				"click",
				"double_click",
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
		x: Type.Optional(Type.Number({ description: "Pixel X (NOT 0-1000)." })),
		y: Type.Optional(Type.Number({ description: "Pixel Y (NOT 0-1000)." })),
		text: Type.Optional(Type.String()),
		url: Type.Optional(Type.String({ description: "URL when type=goto." })),
		keys: Type.Optional(Type.Array(Type.String(), { description: "Keys for keypress." })),
		button: Type.Optional(Type.String()),
		hold_keys: Type.Optional(Type.Array(Type.String())),
		scroll_x: Type.Optional(Type.Number({ description: "Horizontal scroll in pixels (~120/tick)." })),
		scroll_y: Type.Optional(Type.Number({ description: "Vertical scroll in pixels (~120/tick)." })),
		ms: Type.Optional(Type.Number({ description: "Wait duration in ms when type=wait." })),
		path: Type.Optional(
			Type.Array(COORD_PAIR, { description: "Required when type=drag. Two or more {x, y} points." }),
		),
	},
	{ additionalProperties: false },
);

export const GeminiBatchSchema = Type.Object({
	actions: Type.Array(Action, { description: "Ordered list of actions to execute." }),
});

export type GeminiBatchToolInput = Static<typeof GeminiBatchSchema>;

export interface GeminiBatchToolDetails {
	statusText: string;
	actionDescriptions: string[];
	readResults: Array<{ type: "url"; url: string } | { type: "screenshot"; bytes: number }>;
	error?: string;
}

const SETTLE_MS_AFTER_BATCH = 300;

function delay(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

const BATCH_DESCRIPTION = [
	"Execute multiple computer actions in sequence, including ordered read steps like url() and screenshot() anywhere in the batch.",
	"Coordinates use PIXEL units (NOT 0-1000 normalized). Use this tool when you can plan several actions ahead.",
	"Consecutive write actions are flushed together; each url()/screenshot() step returns output in the order it was requested.",
	"If no explicit read step is included, the tool returns one fresh screenshot after execution.",
	"",
	"PREFER this over the per-action tools when:",
	"- Typing text into a field followed by pressing Enter",
	"- Clicking a field and then typing into it",
	"- Navigating with goto (focuses the address bar, types the URL, presses Enter)",
	"- Using back/forward (cua extensions for keyboard back/forward)",
	"- Reading the current URL via url() — returns the address bar contents",
	"",
	"Drag format: when type=drag, include path as an ordered array of {x, y} pixel points (at least two).",
	"Wait format: when type=wait, you may include ms to control the pause duration in milliseconds.",
].join("\n");

export function createGeminiBatchTool(
	translator: ComputerTranslator,
): AgentTool<typeof GeminiBatchSchema, GeminiBatchToolDetails> {
	return {
		name: "batch_computer_actions",
		label: "batch_computer_actions",
		description: BATCH_DESCRIPTION,
		parameters: GeminiBatchSchema,
		async execute(_id, params): Promise<AgentToolResult<GeminiBatchToolDetails>> {
			const actions = (params.actions ?? []) as ModelAction[];
			const actionDescriptions = actions.map(describeShort);
			const content: (TextContent | ImageContent)[] = [];
			let statusText: string;
			let execErr: Error | undefined;
			const readResults: GeminiBatchToolDetails["readResults"] = [];

			let hasScreenshotInResults = false;
			try {
				const result = await translator.executeBatch(actions);
				for (const r of result.readResults) {
					if (r.type === "url") {
						readResults.push({ type: "url", url: r.url });
					} else {
						readResults.push({ type: "screenshot", bytes: r.pngBytes.length });
						hasScreenshotInResults = true;
					}
				}
				statusText = "Actions executed successfully.";
				content.push({ type: "text", text: statusText });
				for (const r of result.readResults) {
					if (r.type === "url") {
						content.push({ type: "text", text: `url(): ${r.url}` });
					} else {
						content.push({
							type: "image",
							data: r.pngBytes.toString("base64"),
							mimeType: "image/png",
						});
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

			const details: GeminiBatchToolDetails = {
				statusText,
				actionDescriptions,
				readResults,
				...(execErr ? { error: execErr.message } : {}),
			};

			if (execErr) throw Object.assign(execErr, { details, content });
			return { content, details };
		},
	};
}

/** Wire-format Gemini FunctionDeclaration for hand-rolled (non-pi) consumers. */
export const GEMINI_BATCH_FUNCTION_DECLARATION = {
	name: "batch_computer_actions",
	description: BATCH_DESCRIPTION,
	parameters: GeminiBatchSchema,
} as const;

function describeShort(action: ModelAction): string {
	const t = typeof action.type === "string" ? action.type : "";
	switch (t) {
		case "click":
		case "double_click":
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
