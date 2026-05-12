import OpenAI from "openai";
import type { ChatCompletion, ChatCompletionMessageParam } from "openai/resources/chat/completions";
import {
	createAssistantMessageEventStream,
	type Api,
	type AssistantMessage,
	type Context,
	type ImageContent,
	type Model,
	type SimpleStreamOptions,
	type StreamFunction,
	type StreamOptions,
	type TextContent,
	type ToolCall,
} from "@earendil-works/pi-ai";
import { CUA_ACTION_TYPES, CUA_BATCH_TOOL_NAME, type CuaAction } from "../common.js";

export const YUTORI_CHAT_COMPLETIONS_API = "yutori-chat-completions";

const YUTORI_BUILTIN_TOOL_NAMES = new Set<string>(CUA_ACTION_TYPES);

export interface YutoriOptions extends StreamOptions {
	temperature?: number;
}

export const streamYutori: StreamFunction<typeof YUTORI_CHAT_COMPLETIONS_API, YutoriOptions> = (model, context, options) => {
	const stream = createAssistantMessageEventStream();
	void runYutoriStream(stream, model, context, options);
	return stream;
};

export const streamSimpleYutori: StreamFunction<typeof YUTORI_CHAT_COMPLETIONS_API, SimpleStreamOptions> = (
	model,
	context,
	options,
) => streamYutori(model, context, options);

export function yutoriBuiltinToolsOnPayload(payload: unknown): unknown | undefined {
	if (!payload || typeof payload !== "object") return undefined;
	const current = payload as { tools?: unknown };
	if (!Array.isArray(current.tools)) return undefined;
	const tools = current.tools.filter((tool) => {
		const name = readToolName(tool);
		return !name || !YUTORI_BUILTIN_TOOL_NAMES.has(name);
	});
	return {
		...(payload as Record<string, unknown>),
		...(tools.length > 0 ? { tools } : { tools: undefined }),
	};
}

async function runYutoriStream(
	stream: ReturnType<typeof createAssistantMessageEventStream>,
	model: Model<Api>,
	context: Context,
	options: YutoriOptions | undefined,
): Promise<void> {
	const output = initialAssistantMessage(model);
	try {
		const apiKey = options?.apiKey || process.env.YUTORI_API_KEY;
		if (!apiKey) throw new Error("missing Yutori API key");
		const client = new OpenAI({
			apiKey,
			baseURL: model.baseUrl || "https://api.yutori.com/v1",
			defaultHeaders: model.headers,
		});
		let payload: Record<string, unknown> = {
			model: model.id,
			messages: convertMessages(context),
			max_completion_tokens: options?.maxTokens ?? model.maxTokens,
			temperature: options?.temperature ?? 0.3,
		};
		const tools = convertTools(context);
		if (tools.length > 0) payload.tools = tools;
		const nextPayload = await options?.onPayload?.(payload, model);
		if (nextPayload !== undefined) payload = nextPayload as Record<string, unknown>;

		const { data: response, response: rawResponse } = await client.chat.completions
			.create(payload as unknown as Parameters<typeof client.chat.completions.create>[0], { signal: options?.signal })
			.withResponse();
		const completion = response as ChatCompletion;
		await options?.onResponse?.({ status: rawResponse.status, headers: headersToRecord(rawResponse.headers) }, model);

		stream.push({ type: "start", partial: output });
		const choice = completion.choices?.[0];
		const message = choice?.message;
		output.responseId = completion.id;
		output.usage = usageFromYutori(completion.usage);
		if (choice?.finish_reason === "tool_calls") output.stopReason = "toolUse";
		else if (choice?.finish_reason === "length") output.stopReason = "length";

		const text = typeof message?.content === "string" ? message.content : "";
		if (text) emitText(stream, output, text);

		const wantsBatch = (context.tools ?? []).some((tool) => tool.name === CUA_BATCH_TOOL_NAME);
		const batchActions: CuaAction[] = [];
		let firstBatchCallId: string | undefined;

		for (const call of message?.tool_calls ?? []) {
			if (call.type !== "function") continue;
			const args = parseArguments(call.function.arguments);
			const canonical = wantsBatch ? toCanonicalAction(call.function.name, args) : undefined;
			if (canonical) {
				batchActions.push(...canonical);
				firstBatchCallId ??= call.id;
				continue;
			}
			const contentIndex = output.content.length;
			const toolCall: ToolCall = {
				type: "toolCall",
				id: call.id,
				name: call.function.name,
				arguments: args,
			};
			output.content.push(toolCall);
			stream.push({ type: "toolcall_start", contentIndex, partial: output });
			stream.push({ type: "toolcall_delta", contentIndex, delta: call.function.arguments ?? "", partial: output });
			stream.push({ type: "toolcall_end", contentIndex, toolCall, partial: output });
		}

		if (batchActions.length > 0) {
			const contentIndex = output.content.length;
			const toolCall: ToolCall = {
				type: "toolCall",
				id: firstBatchCallId ?? `yutori_batch_${Date.now()}`,
				name: CUA_BATCH_TOOL_NAME,
				arguments: { actions: batchActions },
			};
			output.content.push(toolCall);
			output.stopReason = "toolUse";
			stream.push({ type: "toolcall_start", contentIndex, partial: output });
			stream.push({ type: "toolcall_delta", contentIndex, delta: JSON.stringify(toolCall.arguments), partial: output });
			stream.push({ type: "toolcall_end", contentIndex, toolCall, partial: output });
		}

		stream.push({ type: "done", reason: output.stopReason as "stop" | "length" | "toolUse", message: output });
		stream.end();
	} catch (err) {
		output.stopReason = options?.signal?.aborted ? "aborted" : "error";
		output.errorMessage = err instanceof Error ? err.message : String(err);
		stream.push({ type: "error", reason: output.stopReason, error: output });
		stream.end();
	}
}

function initialAssistantMessage(model: Model<Api>): AssistantMessage {
	return {
		role: "assistant",
		content: [],
		api: model.api,
		provider: model.provider,
		model: model.id,
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "stop",
		timestamp: Date.now(),
	};
}

function convertMessages(context: Context): ChatCompletionMessageParam[] {
	const messages: ChatCompletionMessageParam[] = [];
	if (context.systemPrompt) messages.push({ role: "system", content: context.systemPrompt });
	for (const message of context.messages) {
		if (message.role === "user") {
			messages.push({
				role: "user",
				content: typeof message.content === "string" ? message.content : message.content.map(toOpenAIContentPart),
			} as ChatCompletionMessageParam);
		} else if (message.role === "assistant") {
			const text = message.content
				.filter((part): part is TextContent => part.type === "text")
				.map((part) => part.text)
				.join("");
			const toolCalls = message.content
				.filter((part): part is ToolCall => part.type === "toolCall")
				.map((part) => ({
					id: part.id,
					type: "function" as const,
					function: { name: part.name, arguments: JSON.stringify(part.arguments ?? {}) },
				}));
			messages.push({
				role: "assistant",
				content: text || null,
				...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
			});
		} else if (message.role === "toolResult") {
			messages.push({
				role: "tool",
				tool_call_id: message.toolCallId,
				content: message.content.map(toOpenAIContentPart) as unknown as string,
			});
		}
	}
	return messages;
}

function convertTools(context: Context): Array<Record<string, unknown>> {
	return (context.tools ?? [])
		.filter((tool) => !YUTORI_BUILTIN_TOOL_NAMES.has(tool.name))
		.map((tool) => ({
			type: "function",
			function: {
				name: tool.name,
				description: tool.description,
				parameters: tool.parameters,
			},
		}));
}

function emitText(stream: ReturnType<typeof createAssistantMessageEventStream>, output: AssistantMessage, text: string): void {
	const contentIndex = output.content.length;
	const content: TextContent = { type: "text", text };
	output.content.push(content);
	stream.push({ type: "text_start", contentIndex, partial: output });
	stream.push({ type: "text_delta", contentIndex, delta: text, partial: output });
	stream.push({ type: "text_end", contentIndex, content: text, partial: output });
}

function toOpenAIContentPart(part: TextContent | ImageContent): Record<string, unknown> {
	if (part.type === "text") return { type: "text", text: part.text };
	return { type: "image_url", image_url: { url: `data:${part.mimeType};base64,${part.data}` } };
}

function parseArguments(value: string | undefined): Record<string, unknown> {
	if (!value?.trim()) return {};
	return JSON.parse(value) as Record<string, unknown>;
}

const SCROLL_AMOUNT_PER_NOTCH = 120;

function readPoint(value: unknown): { x: number; y: number } | undefined {
	if (!Array.isArray(value) || value.length < 2) return undefined;
	const x = Number(value[0]);
	const y = Number(value[1]);
	if (!Number.isFinite(x) || !Number.isFinite(y)) return undefined;
	return { x, y };
}

function toCanonicalAction(name: string, args: Record<string, unknown>): CuaAction[] | undefined {
	const coords = readPoint(args.coordinates);
	switch (name) {
		case "left_click":
			return coords ? [{ type: "click", x: coords.x, y: coords.y }] : undefined;
		case "right_click":
			return coords ? [{ type: "click", x: coords.x, y: coords.y, button: "right" }] : undefined;
		case "middle_click":
			return coords ? [{ type: "click", x: coords.x, y: coords.y, button: "middle" }] : undefined;
		case "double_click":
			return coords ? [{ type: "double_click", x: coords.x, y: coords.y }] : undefined;
		case "mouse_move":
		case "hover":
			return coords ? [{ type: "move", x: coords.x, y: coords.y }] : undefined;
		case "mouse_down":
			return coords ? [{ type: "mouse_down", x: coords.x, y: coords.y }] : undefined;
		case "mouse_up":
			return coords ? [{ type: "mouse_up", x: coords.x, y: coords.y }] : undefined;
		case "type": {
			const text = typeof args.text === "string" ? args.text : undefined;
			return text !== undefined ? [{ type: "type", text }] : undefined;
		}
		case "key_press":
		case "hold_key": {
			const key = typeof args.key === "string" ? args.key : undefined;
			return key ? [{ type: "keypress", keys: [key] }] : undefined;
		}
		case "scroll": {
			if (!coords) return undefined;
			const amount = typeof args.amount === "number" ? args.amount : 1;
			const direction = typeof args.direction === "string" ? args.direction : "down";
			const ticks = amount * SCROLL_AMOUNT_PER_NOTCH;
			const dx = direction === "left" ? -ticks : direction === "right" ? ticks : 0;
			const dy = direction === "up" ? -ticks : direction === "down" ? ticks : 0;
			return [{ type: "scroll", x: coords.x, y: coords.y, scroll_x: dx, scroll_y: dy }];
		}
		case "drag": {
			const start = readPoint(args.start_coordinates);
			if (!start || !coords) return undefined;
			return [{ type: "drag", path: [start, coords] }];
		}
		case "wait":
			return [{ type: "wait" }];
		case "go_back":
			return [{ type: "back" }];
		case "go_forward":
			return [{ type: "forward" }];
		case "goto_url": {
			const url = typeof args.url === "string" ? args.url : undefined;
			return url ? [{ type: "goto", url }] : undefined;
		}
		default:
			return undefined;
	}
}

function usageFromYutori(usage: unknown): AssistantMessage["usage"] {
	const input = readNumber(usage, "prompt_tokens");
	const output = readNumber(usage, "completion_tokens");
	const totalTokens = readNumber(usage, "total_tokens") || input + output;
	return {
		input,
		output,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
	};
}

function readToolName(tool: unknown): string | undefined {
	if (!tool || typeof tool !== "object") return undefined;
	const obj = tool as { function?: { name?: unknown }; name?: unknown };
	if (typeof obj.function?.name === "string") return obj.function.name;
	if (typeof obj.name === "string") return obj.name;
	return undefined;
}

function readNumber(value: unknown, key: string): number {
	if (!value || typeof value !== "object") return 0;
	const n = (value as Record<string, unknown>)[key];
	return typeof n === "number" && Number.isFinite(n) ? n : 0;
}

function headersToRecord(headers: Headers): Record<string, string> {
	const out: Record<string, string> = {};
	headers.forEach((value, key) => {
		out[key] = value;
	});
	return out;
}
