import {
	Agent,
	type AgentEvent,
	type AgentMessage,
	type AgentTool,
	type StreamFn,
	type ThinkingLevel,
} from "@mariozechner/pi-agent-core";
import {
	type Api,
	type Model,
	registerApiProvider,
	streamOpenAICompletions,
	streamGoogle,
	streamOpenAIResponses,
	streamSimpleOpenAICompletions,
	streamSimple,
	streamSimpleGoogle,
	streamSimpleOpenAIResponses,
} from "@mariozechner/pi-ai";
import {
	createBashTool,
	createEditTool,
	createFindTool,
	createGrepTool,
	createLsTool,
	createReadTool,
	createWriteTool,
} from "@mariozechner/pi-coding-agent";
import {
	buildAnthropicSystemPrompt,
} from "@onkernel/cua-anthropic";
import {
	anthropicComputerOnPayload,
	composeOnPayload,
	createAnthropicContextManagementOnPayload,
	createAnthropicComputerTools,
	registerAnthropicProvider,
	wrapAnthropicStream,
} from "@onkernel/cua-anthropic/pi";
import {
	buildGeminiSystemPrompt,
} from "@onkernel/cua-gemini";
import { createGeminiComputerTools } from "@onkernel/cua-gemini/pi";
import {
	OPENAI_BATCH_INSTRUCTIONS,
} from "@onkernel/cua-openai";
import { createOpenAIComputerTools } from "@onkernel/cua-openai/pi";
import {
	type BrowserSession,
	ComputerTranslator,
} from "@onkernel/cua-translator";
import {
	buildTzafonSystemPrompt,
} from "@onkernel/cua-tzafon";
import {
	createTzafonComputerTools,
	registerTzafonProvider,
} from "@onkernel/cua-tzafon/pi";
import {
	buildYutoriSystemPrompt,
} from "@onkernel/cua-yutori";
import {
	createYutoriComputerTools,
	registerYutoriProvider,
	yutoriBuiltinToolsOnPayload,
} from "@onkernel/cua-yutori/pi";
import {
	type AnthropicModelConfig,
	type Config,
	type GeminiModelConfig,
	type OpenAIModelConfig,
	type TzafonModelConfig,
	type YutoriModelConfig,
	resolveAnthropicModelConfig,
	resolveGeminiModelConfig,
	resolveOpenAIModelConfig,
	resolveTzafonModelConfig,
	resolveYutoriModelConfig,
} from "./config";
import {
	DEFAULT_MODEL_ID,
	type ProviderId,
	loadModel as loadSupportedModel,
} from "./models";
import { appendSkillsToSystemPrompt, type Skill } from "./skills";

let providersRegistered = false;

/**
 * Eagerly register the providers we use. pi-ai's lazy dynamic-import
 * registration breaks under bundlers, so we wire them up at module load.
 */
export function registerProviders(): void {
	if (providersRegistered) return;
	registerApiProvider({
		api: "openai-responses",
		stream: streamOpenAIResponses,
		streamSimple: streamSimpleOpenAIResponses,
	});
	registerApiProvider({
		api: "openai-completions",
		stream: streamOpenAICompletions,
		streamSimple: streamSimpleOpenAICompletions,
	});
	registerAnthropicProvider();
	registerApiProvider({
		api: "google-generative-ai",
		stream: streamGoogle,
		streamSimple: streamSimpleGoogle,
	});
	registerYutoriProvider();
	registerTzafonProvider();
	providersRegistered = true;
}

function mapReasoningEffort(effort: string | undefined): ThinkingLevel {
	const v = (effort ?? "low").trim().toLowerCase();
	switch (v) {
		case "":
		case "low":
			return "low";
		case "none":
			return "off";
		case "minimal":
			return "minimal";
		case "medium":
			return "medium";
		case "high":
			return "high";
		case "xhigh":
			return "xhigh";
		default:
			return "low";
	}
}

export interface CuaAgentOptions {
	cwd: string;
	browser: BrowserSession;
	config: Config;
	modelId?: string; // default DEFAULT_MODEL_ID
	additionalSystemPrompt?: string;
	skills?: Skill[];
	sessionId?: string;
	skipCodingTools?: boolean;
}

export interface CuaAgentHandle {
	agent: Agent;
	translator: ComputerTranslator;
	model: Model<Api>;
	provider: ProviderId;
	modelConfig: OpenAIModelConfig | AnthropicModelConfig | GeminiModelConfig | TzafonModelConfig | YutoriModelConfig;
	thinkingLevel: ThinkingLevel;
	dispose(): Promise<void>;
}

/**
 * Build a fully wired pi-agent-core Agent for cua: provider registered,
 * tools loaded, system prompt set, reasoning effort + auto-compaction
 * applied via the model config.
 */
export function createCuaAgent(opts: CuaAgentOptions): CuaAgentHandle {
	registerProviders();

	const modelId = opts.modelId ?? DEFAULT_MODEL_ID;
	const { provider, model: loadedModel } = loadSupportedModel(modelId);

	const modelConfig = resolveModelConfigForProvider(provider, opts.config, modelId);
	const model = applyProviderBaseUrl(provider, loadedModel, opts.config);
	const thinkingLevel = mapReasoningEffort(modelConfig.reasoningEffort);
	const toolPreamble = modelConfig.toolPreamble ?? true;
	const compactThreshold = (modelConfig as OpenAIModelConfig | AnthropicModelConfig).compactThreshold;

	const translator = new ComputerTranslator({
		client: opts.browser.client,
		sessionId: opts.browser.sessionId,
	});

	const tools = buildAgentTools({
		cwd: opts.cwd,
		translator,
		provider,
		skipCodingTools: opts.skipCodingTools,
	});

	const baseSystemPrompt = buildSystemPromptForProvider(provider, {
		toolPreamble,
		additionalSystemPrompt: opts.additionalSystemPrompt,
	});
	const systemPrompt = appendSkillsToSystemPrompt(baseSystemPrompt, opts.skills ?? []);

	const onPayload = composeOnPayload(
		// OpenAI auto-compaction (no-op for Anthropic/Gemini per the model.api guard).
		typeof compactThreshold === "number" && compactThreshold > 0
			? (payload, m) =>
					m.api === "openai-responses" ? injectContextManagement(payload, compactThreshold) : undefined
			: undefined,
		provider === "anthropic"
			? createAnthropicContextManagementOnPayload({
					compactThreshold: (modelConfig as AnthropicModelConfig).compactThreshold,
				})
			: undefined,
		// Anthropic computer-tool spec injection.
		anthropicComputerOnPayload,
		provider === "yutori" ? yutoriBuiltinToolsOnPayload : undefined,
	);

	const agent = new Agent({
		initialState: {
			systemPrompt,
			model,
			tools,
			thinkingLevel,
		},
		sessionId: opts.sessionId,
		getApiKey: () => resolveApiKey(provider, opts.config),
		streamFn: wrapAnthropicStream(streamSimple as unknown as StreamFn, {
			compactThreshold: provider === "anthropic" ? (modelConfig as AnthropicModelConfig).compactThreshold : undefined,
		}),
		onPayload,
	});

	return {
		agent,
		translator,
		model,
		provider,
		modelConfig,
		thinkingLevel,
		async dispose(): Promise<void> {
			await opts.browser.close();
		},
	};
}

// ─── Tool factory ─────────────────────────────────────────────────────────

interface ToolFactoryOptions {
	cwd: string;
	translator: ComputerTranslator;
	provider: ProviderId;
	skipCodingTools?: boolean;
}

function buildAgentTools(opts: ToolFactoryOptions): AgentTool<any, any>[] {
	const tools: AgentTool<any, any>[] = [];

	switch (opts.provider) {
		case "anthropic":
			tools.push(...createAnthropicComputerTools(opts.translator));
			break;
		case "gemini":
			tools.push(...createGeminiComputerTools(opts.translator));
			break;
		case "tzafon":
			tools.push(...createTzafonComputerTools(opts.translator));
			break;
		case "yutori":
			tools.push(...createYutoriComputerTools(opts.translator));
			break;
		case "openai":
		default:
			tools.push(...createOpenAIComputerTools(opts.translator));
			break;
	}

	if (!opts.skipCodingTools) {
		tools.push(
			createBashTool(opts.cwd),
			createReadTool(opts.cwd),
			createEditTool(opts.cwd),
			createWriteTool(opts.cwd),
			createGrepTool(opts.cwd),
			createFindTool(opts.cwd),
			createLsTool(opts.cwd),
		);
	}

	return tools;
}

// ─── System prompt selection ─────────────────────────────────────────────

const TOOL_INSTRUCTIONS = `Use bash for shell work. Use read, write, edit, grep, find, and ls for workspace files.`;
const TOOL_PREAMBLE_LINE = `Before every tool call, first output a single short sentence describing what you are about to do.`;

interface SystemPromptOptions {
	toolPreamble?: boolean;
	additionalSystemPrompt?: string;
}

function buildSystemPromptForProvider(provider: ProviderId, opts: SystemPromptOptions): string {
	let preamble: string;
	switch (provider) {
		case "anthropic":
			preamble = buildAnthropicSystemPrompt();
			break;
		case "gemini":
			preamble = buildGeminiSystemPrompt();
			break;
		case "tzafon":
			preamble = buildTzafonSystemPrompt();
			break;
		case "yutori":
			preamble = buildYutoriSystemPrompt({ toolPreamble: false });
			break;
		case "openai":
		default:
			preamble = OPENAI_BATCH_INSTRUCTIONS;
			break;
	}

	const sections: string[] = [preamble, TOOL_INSTRUCTIONS];
	if (opts.toolPreamble !== false) sections.push(TOOL_PREAMBLE_LINE);
	const extra = (opts.additionalSystemPrompt ?? "").trim();
	if (extra) sections.push(extra);
	return sections.join("\n\n");
}

// ─── Per-provider config resolution + API key routing ────────────────────

function resolveModelConfigForProvider(
	provider: ProviderId,
	cfg: Config,
	modelId: string,
): OpenAIModelConfig | AnthropicModelConfig | GeminiModelConfig | TzafonModelConfig | YutoriModelConfig {
	switch (provider) {
		case "anthropic":
			return resolveAnthropicModelConfig(cfg, modelId);
		case "gemini":
			return resolveGeminiModelConfig(cfg, modelId);
		case "tzafon":
			return resolveTzafonModelConfig(cfg, modelId);
		case "yutori":
			return resolveYutoriModelConfig(cfg, modelId);
		case "openai":
		default:
			return resolveOpenAIModelConfig(cfg, modelId);
	}
}

function resolveApiKey(provider: ProviderId, cfg: Config): string | undefined {
	switch (provider) {
		case "openai":
			return cfg.openaiApiKey || process.env.OPENAI_API_KEY || undefined;
		case "anthropic":
			return cfg.anthropicApiKey || process.env.ANTHROPIC_API_KEY || undefined;
		case "gemini":
			return cfg.googleApiKey || process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY || undefined;
		case "tzafon":
			return cfg.tzafonApiKey || process.env.TZAFON_API_KEY || undefined;
		case "yutori":
			return cfg.yutoriApiKey || process.env.YUTORI_API_KEY || undefined;
	}
}

function applyProviderBaseUrl(provider: ProviderId, model: Model<Api>, cfg: Config): Model<Api> {
	if (provider === "yutori" && cfg.yutoriBaseUrl) {
		return { ...model, baseUrl: cfg.yutoriBaseUrl };
	}
	return model;
}

/**
 * onPayload hook that injects `context_management: [{type:"compaction", compact_threshold:N}]`
 * into the OpenAI Responses request payload.
 */
function injectContextManagement(payload: unknown, compactThreshold: number): unknown {
	if (!payload || typeof payload !== "object") return undefined;
	const next = { ...(payload as Record<string, unknown>) };
	next.context_management = [
		{
			type: "compaction",
			compact_threshold: compactThreshold,
		},
	];
	return next;
}

export type { Agent, AgentEvent, AgentMessage };
export { DEFAULT_MODEL_ID };
export type { ProviderId };
