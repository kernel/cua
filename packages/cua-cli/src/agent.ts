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
	getModel,
	registerApiProvider,
	streamGoogle,
	streamOpenAIResponses,
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
	type AnthropicModelConfig,
	type Config,
	type GeminiModelConfig,
	type OpenAIModelConfig,
	resolveAnthropicModelConfig,
	resolveGeminiModelConfig,
	resolveOpenAIModelConfig,
} from "./config.js";
import { appendSkillsToSystemPrompt, type Skill } from "./skills.js";

let providersRegistered = false;

/**
 * Supported provider ids. Drives tool selection, system prompt, payload
 * hooks, and API-key routing.
 */
export type ProviderId = "openai" | "anthropic" | "gemini";

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
	registerAnthropicProvider();
	registerApiProvider({
		api: "google-generative-ai",
		stream: streamGoogle,
		streamSimple: streamSimpleGoogle,
	});
	providersRegistered = true;
}

/**
 * Resolve which provider to route a model id to. Explicit override wins;
 * otherwise we infer from the model id prefix.
 *   gemini-*, google/gemini-*, models/gemini-* → gemini
 *   claude-*, anthropic.*                      → anthropic
 *   everything else                            → openai
 */
export function resolveProvider(modelId: string, override?: ProviderId): ProviderId {
	if (override) return override;
	const id = modelId.trim().toLowerCase();
	if (id.startsWith("claude-") || id.startsWith("anthropic.")) return "anthropic";
	if (id.startsWith("gemini-") || id.startsWith("models/gemini-") || id.startsWith("google/gemini-")) return "gemini";
	return "openai";
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
	modelId?: string; // default "gpt-5.4"
	provider?: ProviderId; // explicit override; otherwise inferred from model id
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
	modelConfig: OpenAIModelConfig | AnthropicModelConfig | GeminiModelConfig;
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

	const modelId = opts.modelId ?? "gpt-5.4";
	const provider = resolveProvider(modelId, opts.provider);
	const model = loadModel(provider, modelId);

	const modelConfig = resolveModelConfigForProvider(provider, opts.config, modelId);
	const thinkingLevel = mapReasoningEffort(modelConfig.reasoningEffort);
	const toolPreamble = modelConfig.toolPreamble ?? true;
	const compactThreshold = (modelConfig as OpenAIModelConfig).compactThreshold;

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
		compactThreshold && compactThreshold > 0
			? (payload, m) =>
					m.api === "openai-responses" ? injectContextManagement(payload, compactThreshold) : undefined
			: undefined,
		// Anthropic computer-tool spec injection.
		anthropicComputerOnPayload,
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
		streamFn: wrapAnthropicStream(streamSimple as unknown as StreamFn),
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
): OpenAIModelConfig | AnthropicModelConfig | GeminiModelConfig {
	switch (provider) {
		case "anthropic":
			return resolveAnthropicModelConfig(cfg, modelId);
		case "gemini":
			return resolveGeminiModelConfig(cfg, modelId);
		case "openai":
		default:
			return resolveOpenAIModelConfig(cfg, modelId);
	}
}

/**
 * Map cua's `ProviderId` to pi-ai's provider field. They mostly match, but
 * pi-ai uses `"google"` for Gemini Generative AI models while we use
 * `"gemini"` to keep the LLM provider name aligned with the model family.
 */
function piProviderFor(provider: ProviderId): string {
	switch (provider) {
		case "openai":
			return "openai";
		case "anthropic":
			return "anthropic";
		case "gemini":
			return "google";
	}
}

function loadModel(provider: ProviderId, modelId: string): Model<Api> {
	const piProvider = piProviderFor(provider);
	// pi-ai's getModel is typed against its known model registry; cast
	// to allow user-supplied ids that pi-ai may know about even if they
	// aren't in the literal union. It returns undefined (NOT throws) for
	// unknown ids.
	const fromRegistry = getModel(piProvider as never, modelId as never) as Model<Api> | undefined;
	if (fromRegistry) return fromRegistry;
	throw new Error(`unknown ${provider} model "${modelId}" (not in pi-ai registry)`);
}

function resolveApiKey(provider: ProviderId, cfg: Config): string | undefined {
	switch (provider) {
		case "openai":
			return cfg.openaiApiKey || process.env.OPENAI_API_KEY || undefined;
		case "anthropic":
			return cfg.anthropicApiKey || process.env.ANTHROPIC_API_KEY || undefined;
		case "gemini":
			return cfg.googleApiKey || process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY || undefined;
	}
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
