import type {
	ComputerTranslator,
	ComputerUseModel,
	ComputerUseRunResult,
	ComputerUseToolResult,
} from "@onkernel/cua-translator";
import Lightcone from "@tzafon/lightcone";
import {
	executeTzafonFunctionCall,
	TZAFON_FUNCTION_TOOLS,
	type TzafonComputerToolsOptions,
	type TzafonToolDetails,
} from "./computer.js";
import { TZAFON_DEFAULT_MODEL } from "./official.js";
import { buildTzafonSystemPrompt } from "./system-prompt.js";

const DEFAULT_MAX_OUTPUT_TOKENS = 4096;
const MAX_HISTORY_ITEMS = 30;
const KEEP_RECENT_ITEMS = 22;

export interface TzafonModelOptions extends TzafonComputerToolsOptions {
	apiKey?: string;
	instructions?: string;
	maxOutputTokens?: number;
	temperature?: number;
}

export interface TzafonModelRunDetails {
	model?: string;
}

interface TzafonFunctionCall {
	callId: string;
	name: string;
	args: Record<string, unknown>;
	rawArguments: unknown;
}

type LightconeItem = Record<string, unknown>;

export function tzafon(modelId: string = TZAFON_DEFAULT_MODEL, opts: TzafonModelOptions = {}): ComputerUseModel<TzafonModelRunDetails> {
	return {
		provider: "tzafon",
		modelId,
		async run({ prompt, translator, maxTurns = 50 }): Promise<ComputerUseRunResult<TzafonModelRunDetails>> {
			const apiKey = opts.apiKey || process.env.TZAFON_API_KEY;
			if (!apiKey) {
				throw new Error("missing Tzafon API key");
			}

			const client = new Lightcone({ apiKey });
			const instructions = buildTzafonSystemPrompt({ suffix: opts.instructions });
			const items: LightconeItem[] = [
				imageMessage(
					`data:image/png;base64,${await translator.screenshotBase64()}`,
					`${prompt}\n\nCurrent screenshot:`,
				),
			];
			let response: unknown;

			for (let turn = 0; turn < maxTurns; turn++) {
				pruneHistory(items);
				response = await client.responses.create({
					model: modelId,
					input: items,
					tools: TZAFON_FUNCTION_TOOLS,
					instructions,
					temperature: opts.temperature ?? 0,
					max_output_tokens: opts.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
				} as never);

				const calls = collectResponseItems(response, items);
				if (calls.length === 0) {
					return {
						text: extractMessages(response).join("\n").trim() || "(no response)",
						provider: "tzafon",
						modelId,
						turns: turn + 1,
						details: { model: modelId },
					};
				}

				for (const call of calls) {
					if (call.name === "done") {
						const result = typeof call.args.result === "string" ? call.args.result : "";
						items.push({ type: "function_call_output", call_id: call.callId, output: "ok" });
						return {
							text: result,
							provider: "tzafon",
							modelId,
							turns: turn + 1,
							details: { model: modelId },
						};
					}

					const result = await executeTzafonFunctionCall({
						translator,
						name: call.name,
						input: call.args,
						options: opts,
					});
					items.push(toFunctionOutput(call.callId, result));
					addScreenshotMessage(items, result);
				}
			}

			return {
				text: extractMessages(response).join("\n").trim() || "(max turns reached)",
				provider: "tzafon",
				modelId,
				turns: maxTurns,
				details: { model: modelId },
			};
		},
	};
}

function collectResponseItems(response: unknown, items: LightconeItem[]): TzafonFunctionCall[] {
	const calls: TzafonFunctionCall[] = [];
	for (const item of getArray(response, "output")) {
		const itemType = getString(item, "type");
		if (itemType === "message") {
			const text = extractMessageText(item);
			if (text) items.push({ role: "assistant", content: text });
			continue;
		}
		if (itemType === "function_call") {
			const callId = getString(item, "call_id");
			const name = getString(item, "name");
			const rawArguments = getValue(item, "arguments") ?? "{}";
			const args = parseArguments(rawArguments);
			calls.push({ callId, name, args, rawArguments });
			items.push({
				type: "function_call",
				call_id: callId,
				name,
				arguments: typeof rawArguments === "string" ? rawArguments : JSON.stringify(rawArguments),
			});
		}
	}
	return calls;
}

function toFunctionOutput(callId: string, result: ComputerUseToolResult<TzafonToolDetails>): LightconeItem {
	const text = result.content
		.filter((part): part is { type: "text"; text: string } => part.type === "text")
		.map((part) => part.text)
		.join("\n")
		.trim();
	return {
		type: "function_call_output",
		call_id: callId,
		output: result.isError ? `Error: ${text || "tool execution failed"}` : text || "ok",
	};
}

function addScreenshotMessage(items: LightconeItem[], result: ComputerUseToolResult<TzafonToolDetails>): void {
	const image = [...result.content].reverse().find((part) => part.type === "image");
	if (!image || image.type !== "image") return;
	removeOldImages(items);
	items.push(imageMessage(`data:${image.mimeType};base64,${image.data}`));
}

function imageMessage(imageUrl: string, text = "screenshot"): LightconeItem {
	return {
		role: "user",
		content: [
			{ type: "input_text", text },
			{ type: "input_image", image_url: imageUrl, detail: "auto" },
		],
	};
}

function pruneHistory(items: LightconeItem[]): void {
	if (items.length <= MAX_HISTORY_ITEMS) return;
	items.splice(2, items.length - KEEP_RECENT_ITEMS);
}

function removeOldImages(items: LightconeItem[]): void {
	for (const item of items) {
		const content = item.content;
		if (!Array.isArray(content)) continue;
		const filtered = content.filter((part) => !(part && typeof part === "object" && "type" in part && part.type === "input_image"));
		if (filtered.length === content.length) continue;
		item.content = filtered.length > 0 ? filtered : "(old screenshot)";
	}
}

function extractMessages(response: unknown): string[] {
	return getArray(response, "output")
		.filter((item) => getString(item, "type") === "message")
		.map(extractMessageText)
		.filter(Boolean);
}

function extractMessageText(item: unknown): string {
	return getArray(item, "content")
		.map((block) => getString(block, "text"))
		.filter(Boolean)
		.join("\n")
		.trim();
}

function parseArguments(value: unknown): Record<string, unknown> {
	if (typeof value === "string" && value.trim()) {
		try {
			const parsed = JSON.parse(value);
			return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : {};
		} catch {
			return {};
		}
	}
	if (value && typeof value === "object") return value as Record<string, unknown>;
	return {};
}

function getArray(obj: unknown, key: string): unknown[] {
	const value = getValue(obj, key);
	return Array.isArray(value) ? value : [];
}

function getString(obj: unknown, key: string): string {
	const value = getValue(obj, key);
	return typeof value === "string" ? value : "";
}

function getValue(obj: unknown, key: string): unknown {
	if (!obj || typeof obj !== "object") return undefined;
	return (obj as Record<string, unknown>)[key];
}
