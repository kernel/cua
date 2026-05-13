import type {
	ComputerUseModel,
	ComputerUseRunResult,
	ComputerUseToolResult,
} from "@onkernel/cua-translator";
import { GoogleGenAI } from "@google/genai";
import {
	executeGeminiBatch,
	GEMINI_BATCH_FUNCTION_DECLARATION,
	GEMINI_BATCH_TOOL_NAME,
} from "./batch";
import {
	type GeminiComputerToolsOptions,
	type GeminiToolDetails,
	executeGeminiFunctionCall,
	GEMINI_FUNCTION_DECLARATIONS,
} from "./computer";
import { buildGeminiSystemPrompt } from "./system-prompt";

export interface GeminiModelOptions extends GeminiComputerToolsOptions {
	apiKey?: string;
	systemPromptSuffix?: string;
	includeBatchTool?: boolean;
}

export interface GeminiModelRunDetails {
	finishReason?: string;
}

export function gemini(modelId: string, opts: GeminiModelOptions = {}): ComputerUseModel<GeminiModelRunDetails> {
	return {
		provider: "gemini",
		modelId,
		async run({ prompt, translator, maxTurns = 50 }): Promise<ComputerUseRunResult<GeminiModelRunDetails>> {
			const apiKey = opts.apiKey || process.env.GOOGLE_API_KEY;
			if (!apiKey) {
				throw new Error("missing Google API key");
			}

			const ai = new GoogleGenAI({ apiKey });
			const contents: any[] = [{ role: "user", parts: [{ text: prompt }] }];
			const systemText = buildGeminiSystemPrompt({
				includeBatchNudge: opts.includeBatchTool !== false,
			});
			const systemInstruction = opts.systemPromptSuffix
				? `${systemText}\n\n${opts.systemPromptSuffix}`
				: systemText;

			for (let turn = 0; turn < maxTurns; turn++) {
				const response: any = await ai.models.generateContent({
					model: modelId,
					contents,
					config: {
						systemInstruction,
						tools: [
							{
								functionDeclarations:
									opts.includeBatchTool === false
										? (GEMINI_FUNCTION_DECLARATIONS as any)
										: ([...GEMINI_FUNCTION_DECLARATIONS, GEMINI_BATCH_FUNCTION_DECLARATION] as any),
							},
						],
						thinkingConfig: { includeThoughts: true },
					},
				});

				const candidateContent = response.candidates?.[0]?.content;
				if (!candidateContent) break;
				contents.push(candidateContent);

				const text = extractGeminiText(candidateContent.parts);
				const functionCalls = (candidateContent.parts ?? [])
					.filter(
						(part: unknown): part is { functionCall: { name?: string; args?: Record<string, unknown> } } =>
							typeof part === "object" && part !== null && "functionCall" in part,
					)
					.map((part: { functionCall: { name?: string; args?: Record<string, unknown> } }) => part.functionCall)
					.filter(
						(call: { name?: string; args?: Record<string, unknown> }): call is { name: string; args?: Record<string, unknown> } =>
							typeof call.name === "string",
					);

				if (functionCalls.length === 0) {
					return {
						text: text || "(no response)",
						provider: "gemini",
						modelId,
						turns: turn + 1,
						details: { finishReason: response.candidates?.[0]?.finishReason },
					};
				}

				const parts: any[] = [];
				for (const call of functionCalls) {
					const result =
						call.name === GEMINI_BATCH_TOOL_NAME
							? await executeGeminiBatch(translator, (call.args ?? {}) as any)
							: await executeGeminiFunctionCall({
									translator,
									name: call.name,
									input: call.args ?? {},
									options: opts,
								});
					parts.push(toGeminiFunctionResponse(call.name, result));
				}

				contents.push({ role: "user", parts });
			}

			return {
				text: "(max turns reached)",
				provider: "gemini",
				modelId,
				turns: maxTurns,
			};
		},
	};
}

function toGeminiFunctionResponse(
	name: string,
	result: ComputerUseToolResult<GeminiToolDetails | unknown>,
): Record<string, unknown> {
	const responseParts = result.content
		.filter((part) => part.type === "image")
		.map((part) => ({
			inlineData: {
				mimeType: part.mimeType,
				data: part.data,
			},
		}));
	const text = result.content
		.filter((part): part is { type: "text"; text: string } => part.type === "text")
		.map((part) => part.text)
		.join("\n")
		.trim();
	return {
		functionResponse: {
			name,
			response: {
				text,
				...(result.isError ? { error: text || "tool execution failed" } : {}),
			},
			...(responseParts.length > 0 ? { parts: responseParts } : {}),
		},
	};
}

function extractGeminiText(parts: unknown): string {
	if (!Array.isArray(parts)) return "";
	return parts
		.filter(
			(part): part is { text: string } =>
				typeof part === "object" && part !== null && "text" in part && typeof (part as { text?: unknown }).text === "string",
		)
		.map((part) => part.text)
		.join(" ")
		.trim();
}
