import type { Api, Model } from "@earendil-works/pi-ai";
import type { ComputerToolCoordinateSystem, CuaPayloadHook, CuaProviderModule } from "../common";
import { computerToolExecutors, computerTools } from "./actions";

export {
	ANTHROPIC_BATCH_TOOL_NAME,
	ANTHROPIC_CUA_ACTION_TYPES,
	computerToolExecutors,
	computerTools,
	createActionSchema,
} from "./actions";
export type {
	AnthropicAction,
	AnthropicComputerToolsOptions,
	AnthropicComputerToolsOptions as ComputerToolsOptions,
} from "./actions";

// Anthropic's quickstart uses pixel coordinates for both its computer and
// browser tools.
// Source: https://github.com/anthropics/claude-quickstarts/tree/main/computer-use-best-practices
export function coordinateSystem(): ComputerToolCoordinateSystem {
	return { type: "pixel" };
}

export const ANTHROPIC_COMPUTER_INSTRUCTIONS = `You control a Kernel cloud browser through individual browser tools. Use keyboard navigation where possible, and request screenshots when you need to inspect state.`;

export function buildAnthropicSystemPrompt(opts: { suffix?: string } = {}): string {
	return [ANTHROPIC_COMPUTER_INSTRUCTIONS, opts.suffix].filter(Boolean).join("\n\n");
}

export const anthropicAdaptiveThinkingOnPayload: CuaPayloadHook = (payload, model) => {
	if (!isAdaptiveThinkingModel(model)) return undefined;
	if (!isRecord(payload)) return undefined;
	const thinking = payload.thinking;
	if (!isRecord(thinking) || thinking.type !== "enabled") return undefined;

	const next = { ...payload };
	next.thinking = { type: "adaptive" };
	const outputConfig = isRecord(payload.output_config) ? { ...payload.output_config } : {};
	outputConfig.effort = effortFromBudgetTokens(thinking.budget_tokens);
	next.output_config = outputConfig;
	return next;
};

function isAdaptiveThinkingModel(model: Model<Api>): boolean {
	if (model.provider !== "anthropic") return false;
	const id = model.id.toLowerCase();
	return (
		id.startsWith("claude-fable-5") ||
		id.startsWith("claude-mythos-5") ||
		id.startsWith("claude-mythos-preview") ||
		id.startsWith("claude-sonnet-5") ||
		id.startsWith("claude-sonnet-4-6") ||
		id.startsWith("claude-opus-4-8") ||
		id.startsWith("claude-opus-4-7") ||
		id.startsWith("claude-opus-4-6")
	);
}

function effortFromBudgetTokens(budgetTokens: unknown): "low" | "medium" | "high" | "xhigh" {
	if (typeof budgetTokens !== "number" || !Number.isFinite(budgetTokens)) return "high";
	if (budgetTokens <= 4_096) return "low";
	if (budgetTokens <= 8_192) return "medium";
	if (budgetTokens <= 20_000) return "high";
	return "xhigh";
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export const providerModule = {
	toolDefinitions: computerTools,
	toolExecutors: computerToolExecutors,
	coordinateSystem,
	buildSystemPrompt: buildAnthropicSystemPrompt,
	onPayload: anthropicAdaptiveThinkingOnPayload,
} satisfies CuaProviderModule;
