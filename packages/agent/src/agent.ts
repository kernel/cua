import {
	Agent,
	AgentHarness,
	type AgentHarnessOptions,
	type AgentOptions,
	type AgentState,
	type AgentTool,
	type PromptTemplate,
	type Skill,
	type StreamFn,
} from "@earendil-works/pi-agent-core";
import {
	type Api,
	CUA_NAVIGATION_TOOL_NAME,
	type CuaModelRef,
	getCuaEnvApiKey,
	type Model,
	resolveCuaRuntimeSpec,
	type SimpleStreamOptions,
	streamSimple,
} from "@onkernel/cua-ai";
import type Kernel from "@onkernel/sdk";
import { createCuaComputerTools } from "./tools";
import { InternalComputerTranslator, type KernelBrowser } from "./translator/translator";

/** A CUA model reference string or a concrete pi model object. */
type CuaRuntimeInput = CuaModelRef | Model<Api>;

type CuaRuntimeSpec = ReturnType<typeof resolveCuaRuntimeSpec>;

/**
 * Agent state exposed by {@link CuaAgent}.
 *
 * It is the regular pi `AgentState`, except assigning `state.model` may use a
 * CUA model ref such as `"openai:gpt-5.5"`. CUA-owned tools and the default
 * system prompt are refreshed to match the new provider runtime.
 */
export interface CuaAgentState extends Omit<AgentState, "model"> {
	/** The concrete pi model currently used by the underlying agent loop. */
	get model(): Model<Api>;
	/** Assign a concrete pi model or CUA model ref and refresh CUA runtime defaults. */
	set model(model: CuaRuntimeInput);
}

/** Initial state for {@link CuaAgent}. */
type CuaAgentInitialState = Omit<NonNullable<AgentOptions["initialState"]>, "model" | "tools"> & {
	/** Model to use for the first turn. CUA refs are resolved before pi sees the state. */
	model: CuaRuntimeInput;
};

/**
 * Constructor options for {@link CuaAgent}.
 *
 * `browser` and `client` are used to build the default computer-use tools.
 * Everything else follows pi `AgentOptions`, with `initialState.model`
 * widened to accept CUA model refs.
 */
export type CuaAgentOptions = Omit<AgentOptions, "initialState"> & {
	/** Kernel browser session used by default CUA tools. */
	browser: KernelBrowser;
	/** Kernel SDK client used by default CUA tools. */
	client: Kernel;
	/** Initial pi state plus a CUA-aware model value. */
	initialState: CuaAgentInitialState;
	/** Add your own pi tools alongside the built-in browser tools. */
	extraTools?: AgentTool[];
	/** Expose a helper for browser navigation and URL reads. */
	computerUseExtra?: boolean;
};

/**
 * Constructor options for {@link CuaAgentHarness}.
 *
 * The harness keeps pi `AgentHarnessOptions` intact except that `model`
 * accepts CUA refs and `browser`/`client` are required to build default
 * computer-use tools. Callers provide pi's `env` and `session` directly.
 */
export type CuaAgentHarnessOptions<
	TSkill extends Skill = Skill,
	TPromptTemplate extends PromptTemplate = PromptTemplate,
> = Omit<AgentHarnessOptions<TSkill, TPromptTemplate, AgentTool>, "model" | "tools"> & {
	/** Kernel browser session used by default CUA tools. */
	browser: KernelBrowser;
	/** Kernel SDK client used by default CUA tools. */
	client: Kernel;
	/** Model used by the harness. CUA refs are resolved before pi sees the model. */
	model: CuaRuntimeInput;
	/** Add your own pi tools alongside the built-in browser tools. */
	extraTools?: AgentTool[];
	/** Expose a helper for browser navigation and URL reads. */
	computerUseExtra?: boolean;
	/** Optional payload hook composed after the provider-specific CUA payload hook. */
	onPayload?: SimpleStreamOptions["onPayload"];
};

/**
 * Holds the CUA-specific pieces that have to change when a model changes:
 * the resolved runtime spec, the browser translator built for that spec, and
 * the tools/prompt/payload hooks derived from it. Caller-owned `extraTools`
 * are appended after the CUA defaults.
 */
class CuaRuntimeController {
	private runtimeSpec: CuaRuntimeSpec;
	private translator: InternalComputerTranslator;

	constructor(
		private readonly options: {
			browser: KernelBrowser;
			client: Kernel;
			model: CuaRuntimeInput;
			extraTools?: AgentTool[];
			computerUseExtra?: boolean;
			onPayload?: SimpleStreamOptions["onPayload"];
		},
	) {
		this.runtimeSpec = resolveCuaRuntimeSpec(options.model);
		this.translator = this.createTranslator();
	}

	get model(): Model<Api> {
		return this.runtimeSpec.model;
	}

	get systemPrompt(): string {
		return this.runtimeSpec.defaultSystemPrompt;
	}

	setModel(model: CuaRuntimeInput): void {
		this.runtimeSpec = resolveCuaRuntimeSpec(model);
		this.translator = this.createTranslator();
	}

	tools(): AgentTool[] {
		return [
			...createCuaComputerTools({
				browser: this.options.browser,
				client: this.options.client,
				toolExecutors: this.runtimeSpec.toolExecutors,
				coordinateSystem: this.runtimeSpec.coordinateSystem,
				screenshot: this.runtimeSpec.screenshot,
				computerUseExtra: this.options.computerUseExtra,
			}),
			...(this.options.extraTools ?? []),
		];
	}

	onPayload(): SimpleStreamOptions["onPayload"] {
		const runtimeSpec = this.runtimeSpec;
		const providerOnPayload: SimpleStreamOptions["onPayload"] | undefined = runtimeSpec.onPayload
			? async (payload, model) =>
					runtimeSpec.onPayload?.(payload, model as Model<Api>, {
						keepToolNames: this.keepToolNames(),
						getScreenshot: () => this.translator.screenshot(),
					})
			: undefined;
		return composeOnPayload(providerOnPayload, this.options.onPayload);
	}

	keepToolNames(): string[] {
		return [
			...(this.options.extraTools ?? []).map((tool) => tool.name),
			...(this.options.computerUseExtra ? [CUA_NAVIGATION_TOOL_NAME] : []),
		];
	}

	private createTranslator(): InternalComputerTranslator {
		return new InternalComputerTranslator({
			browser: this.options.browser,
			client: this.options.client,
			coordinateSystem: this.runtimeSpec.coordinateSystem,
			screenshot: this.runtimeSpec.screenshot,
		});
	}
}

/** Harness auth default following the documented CUA env-var convention. */
async function getCuaEnvApiKeyAndHeaders(model: Model<Api>): Promise<{ apiKey: string } | undefined> {
	const apiKey = getCuaEnvApiKey(model.provider);
	return apiKey ? { apiKey } : undefined;
}

/**
 * Pi `Agent` configured for Kernel browser computer use.
 *
 * Use this class when you want direct access to the lower-level pi agent state,
 * queues, event stream, and `state.model` mutation model. It resolves CUA model
 * refs, installs provider-appropriate CUA tools by default, and keeps those
 * defaults in sync when `agent.state.model` changes.
 */
export class CuaAgent extends Agent {
	private readonly runtime: CuaRuntimeController;
	private readonly ownsSystemPrompt: boolean;
	private stateProxy?: CuaAgentState;

	constructor(options: CuaAgentOptions) {
		const {
			browser,
			client,
			initialState,
			onPayload,
			streamFn,
			prepareNextTurn,
			extraTools,
			computerUseExtra,
			...agentOptions
		} = options;
		const runtime = new CuaRuntimeController({
			browser,
			client,
			model: initialState.model,
			extraTools,
			computerUseExtra,
			onPayload,
		});
		const wrappedStreamFn: StreamFn = (model, context, streamOptions) => {
			const optionsWithCuaRuntime = {
				...streamOptions,
				onPayload: runtime.onPayload(),
				keepToolNames: runtime.keepToolNames(),
			} as SimpleStreamOptions & { keepToolNames?: string[] };
			return (streamFn ?? streamSimple)(model, context, optionsWithCuaRuntime);
		};

		super({
			...agentOptions,
			getApiKey: agentOptions.getApiKey ?? getCuaEnvApiKey,
			streamFn: wrappedStreamFn,
			initialState: {
				...initialState,
				model: runtime.model,
				tools: runtime.tools(),
				systemPrompt: initialState.systemPrompt ?? runtime.systemPrompt,
			},
		});

		this.runtime = runtime;
		this.ownsSystemPrompt = initialState.systemPrompt === undefined;
		/**
		 * pi calls `prepareNextTurn` between provider requests. Wrapping it lets CUA
		 * honor any user-provided turn update while also refreshing provider-specific
		 * defaults if that update changes the model.
		 */
		this.prepareNextTurn = async (signal: AbortSignal | undefined) => {
			const update = await prepareNextTurn?.(signal);
			if (update?.model) {
				this.applyRuntime(update.model as CuaRuntimeInput);
			}

			const state = super.state;
			const context = update?.context ?? {
				systemPrompt: state.systemPrompt,
				messages: state.messages.slice(),
				tools: state.tools.slice(),
			};

			return {
				...update,
				model: state.model,
				context: {
					...context,
					systemPrompt: this.ownsSystemPrompt ? state.systemPrompt : context.systemPrompt,
					tools: state.tools.slice(),
				},
			};
		};
	}

	/**
	 * Return a state proxy so `agent.state.model = "provider:model"` can behave
	 * like pi's normal mutable state while also re-resolving CUA tools, prompt,
	 * and payload hooks for the selected provider.
	 */
	override get state(): CuaAgentState {
		if (!this.stateProxy) {
			this.stateProxy = new Proxy(super.state, {
				set: (target, prop, value, receiver) => {
					if (prop === "model") {
						this.applyRuntime(value as CuaRuntimeInput);
						return true;
					}
					return Reflect.set(target, prop, value, receiver);
				},
			}) as CuaAgentState;
		}
		return this.stateProxy;
	}

	private applyRuntime(model: CuaRuntimeInput): void {
		this.runtime.setModel(model);
		const state = super.state;
		state.model = this.runtime.model;
		state.tools = this.runtime.tools();
		if (this.ownsSystemPrompt) {
			state.systemPrompt = this.runtime.systemPrompt;
		}
	}
}

/**
 * Pi `AgentHarness` configured for Kernel browser computer use.
 *
 * Use this class when you want pi's higher-level harness APIs for sessions,
 * resources, prompt templates, queue events, compaction, and model selection.
 * It installs provider CUA tools by default and keeps CUA-owned runtime
 * defaults in sync through `setModel()`.
 */
export class CuaAgentHarness<
	TSkill extends Skill = Skill,
	TPromptTemplate extends PromptTemplate = PromptTemplate,
> extends AgentHarness<TSkill, TPromptTemplate, AgentTool> {
	private readonly runtime: CuaRuntimeController;
	private requestedActiveToolNames?: string[];

	constructor(options: CuaAgentHarnessOptions<TSkill, TPromptTemplate>) {
		const {
			browser,
			client,
			model,
			extraTools,
			computerUseExtra,
			systemPrompt,
			getApiKeyAndHeaders,
			onPayload,
			activeToolNames,
			...harnessOptions
		} = options;
		const runtime = new CuaRuntimeController({
			browser,
			client,
			model,
			extraTools,
			computerUseExtra,
			onPayload,
		});
		const resolvedTools = runtime.tools();

		super({
			...harnessOptions,
			model: runtime.model,
			tools: resolvedTools,
			systemPrompt: systemPrompt ?? (() => runtime.systemPrompt),
			getApiKeyAndHeaders: getApiKeyAndHeaders ?? getCuaEnvApiKeyAndHeaders,
			activeToolNames: activeToolNames ?? resolvedTools.map((tool) => tool.name),
		});

		this.runtime = runtime;
		this.requestedActiveToolNames = activeToolNames;
		this.on("before_provider_payload", async ({ model, payload }: { model: Model<Api>; payload: unknown }) => {
			const onPayload = this.runtime.onPayload();
			if (!onPayload) return { payload };
			return { payload: (await onPayload(payload, model)) ?? payload };
		});
	}

	/**
	 * Mirror pi `AgentHarness.setModel()` while accepting CUA model refs.
	 *
	 * The override refreshes CUA-owned tools before delegating to pi so the
	 * harness snapshot and session model-change entry are written with the
	 * concrete model selected by `@onkernel/cua-ai`.
	 */
	override async setModel(model: CuaRuntimeInput): Promise<void> {
		this.runtime.setModel(model);
		const tools = this.runtime.tools();
		await super.setTools(tools, this.requestedActiveToolNames ?? tools.map((tool) => tool.name));
		await super.setModel(this.runtime.model);
	}

	override async setActiveTools(toolNames: string[]): Promise<void> {
		await super.setActiveTools(toolNames);
		this.requestedActiveToolNames = [...toolNames];
	}
}

function composeOnPayload(first: AgentOptions["onPayload"], second: AgentOptions["onPayload"]): AgentOptions["onPayload"] {
	if (!first) return second;
	if (!second) return first;
	return async (payload, modelRef) => {
		const afterFirst = await first(payload, modelRef);
		return second(afterFirst ?? payload, modelRef);
	};
}
