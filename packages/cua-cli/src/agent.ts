import type { Api, CuaModelRef, Model } from "@onkernel/cua-ai";
import { resolveCuaRuntimeSpec } from "@onkernel/cua-ai";
import {
	Agent,
	CuaAgentHarness,
	type AgentEvent,
	type AgentMessage,
	type AgentTool,
	type ThinkingLevel,
	InMemorySessionRepo,
} from "@onkernel/cua-agent";
import {
	createBashTool,
	createEditTool,
	createFindTool,
	createGrepTool,
	createLsTool,
	createReadTool,
	createWriteTool,
} from "@mariozechner/pi-coding-agent";
import { createCuaComputerTools, NodeExecutionEnv } from "@onkernel/cua-agent";
import type { BrowserSession } from "@onkernel/cua-translator";
import { ComputerTranslator } from "@onkernel/cua-translator";
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
import type { CuaSessionState } from "./sessions";

const TOOL_INSTRUCTIONS = `Use bash for shell work. Use read, write, edit, grep, find, and ls for workspace files.`;
const TOOL_PREAMBLE_LINE = `Before every tool call, first output a single short sentence describing what you are about to do.`;

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
	session?: CuaSessionState;
	modelId?: string; // default DEFAULT_MODEL_ID
	additionalSystemPrompt?: string;
	skills?: Skill[];
	skipCodingTools?: boolean;
}

export interface CuaAgentHandle {
	harness: CuaAgentHarness;
	agent: Agent;
	translator: ComputerTranslator;
	model: Model<Api>;
	provider: ProviderId;
	modelConfig: OpenAIModelConfig | AnthropicModelConfig | GeminiModelConfig | TzafonModelConfig | YutoriModelConfig;
	thinkingLevel: ThinkingLevel;
	dispose(): Promise<void>;
}

/**
 * Build a fully wired CUA AgentHarness for cua-cli:
 * tools loaded, system prompt set, reasoning effort + auto-compaction
 * applied via the model config.
 */
export async function createCuaAgent(opts: CuaAgentOptions): Promise<CuaAgentHandle> {
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

	const runtimeInput = toRuntimeInput(provider, model.id);
	const runtimeSpec = resolveCuaRuntimeSpec(runtimeInput);
	const kernelBrowser = toKernelBrowser(opts.browser);
	const tools = buildAgentTools({
		cwd: opts.cwd,
		browser: kernelBrowser,
		client: opts.browser.client,
		toolDefinitions: runtimeSpec.toolDefinitions,
		skipCodingTools: opts.skipCodingTools,
	});

	const baseSystemPrompt = buildSystemPrompt(runtimeSpec.defaultSystemPrompt, {
		toolPreamble,
		additionalSystemPrompt: opts.additionalSystemPrompt,
	});
	const systemPrompt = appendSkillsToSystemPrompt(baseSystemPrompt, opts.skills ?? []);
	const sessionState = opts.session ?? (await createEphemeralSessionState(opts.cwd));

	const harness = new CuaAgentHarness({
		browser: kernelBrowser,
		client: opts.browser.client,
		env: sessionState.env,
		session: sessionState.session,
		model,
		tools,
		thinkingLevel,
		systemPrompt,
		getApiKeyAndHeaders: async (requestModel) => {
			const apiKey = resolveApiKey(providerIdForModelProvider(requestModel.provider), opts.config);
			return apiKey ? { apiKey } : undefined;
		},
		onPayload:
			typeof compactThreshold === "number" && compactThreshold > 0
				? async (payload, runtimeModel) =>
						runtimeModel.api === "openai-responses"
							? injectContextManagement(payload, compactThreshold)
							: undefined
				: undefined,
	});
	const agent = harness.agent;

	return {
		harness,
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

interface ToolFactoryOptions {
	cwd: string;
	browser: Parameters<typeof createCuaComputerTools>[0]["browser"];
	client: Parameters<typeof createCuaComputerTools>[0]["client"];
	toolDefinitions: ReturnType<typeof resolveCuaRuntimeSpec>["toolDefinitions"];
	skipCodingTools?: boolean;
}

function buildAgentTools(opts: ToolFactoryOptions): AgentTool[] {
	const tools: AgentTool[] = createCuaComputerTools({
		browser: opts.browser,
		client: opts.client,
		toolDefinitions: opts.toolDefinitions,
	});

	if (!opts.skipCodingTools) {
		tools.push(
			createBashTool(opts.cwd) as AgentTool,
			createReadTool(opts.cwd) as AgentTool,
			createEditTool(opts.cwd) as AgentTool,
			createWriteTool(opts.cwd) as AgentTool,
			createGrepTool(opts.cwd) as AgentTool,
			createFindTool(opts.cwd) as AgentTool,
			createLsTool(opts.cwd) as AgentTool,
		);
	}

	return tools;
}

interface SystemPromptOptions {
	toolPreamble?: boolean;
	additionalSystemPrompt?: string;
}

function buildSystemPrompt(defaultSystemPrompt: string, opts: SystemPromptOptions): string {
	const sections: string[] = [defaultSystemPrompt, TOOL_INSTRUCTIONS];
	if (opts.toolPreamble !== false) sections.push(TOOL_PREAMBLE_LINE);
	const extra = (opts.additionalSystemPrompt ?? "").trim();
	if (extra) sections.push(extra);
	return sections.join("\n\n");
}

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

function providerIdForModelProvider(provider: string): ProviderId {
	if (provider === "google") return "gemini";
	if (provider === "openai" || provider === "anthropic" || provider === "tzafon" || provider === "yutori") {
		return provider;
	}
	return "openai";
}

function toRuntimeInput(provider: ProviderId, modelId: string): CuaModelRef {
	const runtimeProvider = provider === "gemini" ? "google" : provider;
	return `${runtimeProvider}:${modelId}` as CuaModelRef;
}

async function createEphemeralSessionState(cwd: string): Promise<CuaSessionState> {
	const repo = new InMemorySessionRepo();
	return {
		env: new NodeExecutionEnv({ cwd }),
		session: await repo.create(),
		resumed: false,
		priorMessageCount: 0,
		getSessionFile: () => undefined,
	};
}

function toKernelBrowser(browser: BrowserSession): Parameters<typeof createCuaComputerTools>[0]["browser"] {
	return {
		session_id: browser.sessionId,
		browser_live_view_url: browser.liveUrl ?? null,
	} as Parameters<typeof createCuaComputerTools>[0]["browser"];
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
