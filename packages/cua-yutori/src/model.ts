import type {
	ComputerUseModel,
	ComputerUseRunResult,
} from "@onkernel/cua-translator";
import OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { executeYutoriFunctionCall, type YutoriComputerToolsOptions } from "./computer.js";

export interface YutoriModelOptions extends YutoriComputerToolsOptions {
	apiKey?: string;
	baseUrl?: string;
	maxCompletionTokens?: number;
	temperature?: number;
}

export interface YutoriModelRunDetails {
	finishReason?: string | null;
}

export function yutori(modelId: string, opts: YutoriModelOptions = {}): ComputerUseModel<YutoriModelRunDetails> {
	return {
		provider: "yutori",
		modelId,
		async run({ prompt, translator, maxTurns = 50 }): Promise<ComputerUseRunResult<YutoriModelRunDetails>> {
			const apiKey = opts.apiKey || process.env.YUTORI_API_KEY;
			if (!apiKey) {
				throw new Error("missing Yutori API key");
			}
			const client = new OpenAI({
				apiKey,
				baseURL: opts.baseUrl ?? "https://api.yutori.com/v1",
			});

			const messages: ChatCompletionMessageParam[] = [
				{
					role: "user",
					content: [
						{ type: "text", text: prompt },
						{
							type: "image_url",
							image_url: {
								url: `data:image/png;base64,${await translator.screenshotBase64()}`,
							},
						},
					],
				},
			];

			for (let turn = 0; turn < maxTurns; turn++) {
				const response = await client.chat.completions.create({
					model: modelId,
					messages,
					max_completion_tokens: opts.maxCompletionTokens ?? 4096,
					temperature: opts.temperature ?? 0.3,
				});
				const choice = response.choices[0];
				const message = choice?.message;
				if (!message) break;
				messages.push(message);

				const toolCalls = message.tool_calls ?? [];
				if (toolCalls.length === 0) {
					return {
						text: message.content ?? "(no response)",
						provider: "yutori",
						modelId,
						turns: turn + 1,
						details: { finishReason: choice?.finish_reason ?? null },
					};
				}

				for (const toolCall of toolCalls) {
					const functionCall = (toolCall as { function?: { name?: string; arguments?: string } }).function;
					if (!functionCall?.name) continue;
					const result = await executeYutoriFunctionCall({
						translator,
						name: functionCall.name,
						input: parseArguments(functionCall.arguments ?? ""),
						options: opts,
					});
					messages.push({
						role: "tool",
						tool_call_id: toolCall.id,
						content: toYutoriToolContent(result.content),
					} as ChatCompletionMessageParam);
				}
			}

			return {
				text: "(max turns reached)",
				provider: "yutori",
				modelId,
				turns: maxTurns,
			};
		},
	};
}

function parseArguments(value: string): Record<string, unknown> {
	if (!value.trim()) return {};
	return JSON.parse(value) as Record<string, unknown>;
}

function toYutoriToolContent(content: Array<{ type: string; text?: string; data?: string; mimeType?: string }>): any {
	return content.map((part) =>
		part.type === "image"
			? {
					type: "image_url",
					image_url: { url: `data:${part.mimeType};base64,${part.data}` },
				}
			: {
					type: "text",
					text: part.text ?? "",
				},
	);
}
