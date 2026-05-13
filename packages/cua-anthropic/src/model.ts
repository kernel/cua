import type {
	ComputerTranslator,
	ComputerUseModel,
	ComputerUseRunResult,
	ComputerUseToolResult,
} from "@onkernel/cua-translator";
import { Anthropic } from "@anthropic-ai/sdk";
import { ANTHROPIC_BATCH_TOOL_WIRE_SPEC, executeAnthropicBatch } from "./batch";
import {
	type AnthropicComputerInput,
	executeAnthropicComputerAction,
} from "./computer";
import {
	anthropicComputerToolForModel,
	anthropicComputerUseBetaForModel,
	ANTHROPIC_COMPACTION_BETA,
	ANTHROPIC_COMPACTION_EDIT_TYPE,
	ANTHROPIC_COMPACTION_MIN_TRIGGER_TOKENS,
	anthropicSupportsCompaction,
} from "./official";
import { compactAnthropicMessagesForRequest } from "./context";
import { buildAnthropicSystemPrompt } from "./system-prompt";

export interface AnthropicModelOptions {
	apiKey?: string;
	baseUrl?: string;
	systemPromptSuffix?: string;
	includeBatchTool?: boolean;
	maxTokens?: number;
	thinkingBudgetTokens?: number;
	compactThreshold?: number | false;
}

export interface AnthropicModelRunDetails {
	stopReason?: string;
}

export function anthropic(modelId: string, opts: AnthropicModelOptions = {}): ComputerUseModel<AnthropicModelRunDetails> {
	return {
		provider: "anthropic",
		modelId,
		async run({ prompt, translator, maxTurns = 50 }): Promise<ComputerUseRunResult<AnthropicModelRunDetails>> {
			const apiKey = opts.apiKey || process.env.ANTHROPIC_API_KEY;
			if (!apiKey) {
				throw new Error("missing Anthropic API key");
			}
			const client = new Anthropic({
				apiKey,
				maxRetries: 4,
				...(opts.baseUrl ? { baseURL: opts.baseUrl } : {}),
			});

			const messages: any[] = [{ role: "user", content: prompt }];
			const systemText = buildAnthropicSystemPrompt({
				includeBatchNudge: opts.includeBatchTool !== false,
			});
			const system = opts.systemPromptSuffix ? `${systemText}\n\n${opts.systemPromptSuffix}` : systemText;
			const computerTool = anthropicComputerToolForModel(modelId);
			const computerBeta = anthropicComputerUseBetaForModel(modelId);
			const useCompaction = opts.compactThreshold !== false && anthropicSupportsCompaction(modelId);

			for (let turn = 0; turn < maxTurns; turn++) {
				const response: any = await client.beta.messages.create({
					model: modelId,
					max_tokens: opts.maxTokens ?? 4096,
					messages: compactAnthropicMessagesForRequest(messages),
					system: [{ type: "text", text: system }],
					tools:
						opts.includeBatchTool === false
							? [computerTool]
							: [computerTool, ANTHROPIC_BATCH_TOOL_WIRE_SPEC],
					betas: useCompaction ? [computerBeta, ANTHROPIC_COMPACTION_BETA] : [computerBeta],
					...(useCompaction
						? {
								context_management: anthropicCompactionContextManagement(
									typeof opts.compactThreshold === "number" ? opts.compactThreshold : undefined,
								),
							}
						: {}),
					...(opts.thinkingBudgetTokens
						? { thinking: { type: "enabled", budget_tokens: opts.thinkingBudgetTokens } }
						: {}),
				});

				messages.push({
					role: "assistant",
					content: response.content,
				});

				if (response.stop_reason === "end_turn") {
					return {
						text: extractAnthropicText(response.content),
						provider: "anthropic",
						modelId,
						turns: turn + 1,
						details: { stopReason: response.stop_reason },
					};
				}

				const toolResults: any[] = [];
				for (const block of response.content ?? []) {
					if (!block || block.type !== "tool_use") continue;
					if (block.name === "computer") {
						const result = await executeAnthropicComputerAction(
							translator,
							block.input as AnthropicComputerInput,
						);
						toolResults.push(toAnthropicToolResult(block.id, result));
						continue;
					}
					if (block.name === ANTHROPIC_BATCH_TOOL_WIRE_SPEC.name) {
						const result = await executeAnthropicBatch(translator, block.input);
						toolResults.push(toAnthropicToolResult(block.id, result));
						continue;
					}
				}

				if (toolResults.length === 0) {
					return {
						text: extractAnthropicText(response.content) || "(no response)",
						provider: "anthropic",
						modelId,
						turns: turn + 1,
						details: { stopReason: response.stop_reason },
					};
				}

				messages.push({
					role: "user",
					content: toolResults,
				});
			}

			return {
				text: "(max turns reached)",
				provider: "anthropic",
				modelId,
				turns: maxTurns,
			};
		},
	};
}

function anthropicCompactionContextManagement(compactThreshold: number | undefined): Record<string, unknown> {
	const edit: Record<string, unknown> = { type: ANTHROPIC_COMPACTION_EDIT_TYPE };
	if (typeof compactThreshold === "number" && Number.isFinite(compactThreshold)) {
		edit.trigger = {
			type: "input_tokens",
			value: Math.max(ANTHROPIC_COMPACTION_MIN_TRIGGER_TOKENS, Math.trunc(compactThreshold)),
		};
	}
	return { edits: [edit] };
}

function toAnthropicToolResult(
	toolUseId: string,
	result: ComputerUseToolResult<unknown>,
): Record<string, unknown> {
	return {
		type: "tool_result",
		tool_use_id: toolUseId,
		content: result.content.map((part) =>
			part.type === "text"
				? {
						type: "text",
						text: part.text,
					}
				: {
						type: "image",
						source: {
							type: "base64",
							media_type: part.mimeType,
							data: part.data,
						},
					},
		),
		...(result.isError ? { is_error: true } : {}),
	};
}

function extractAnthropicText(content: unknown): string {
	if (!Array.isArray(content)) return "";
	return content
		.filter(
			(block): block is { type: "text"; text: string } =>
				typeof block === "object" && block !== null && (block as { type?: unknown }).type === "text" && typeof (block as { text?: unknown }).text === "string",
		)
		.map((block) => block.text)
		.join("")
		.trim();
}
