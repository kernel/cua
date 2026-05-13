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
} from "./vendor/pi-agent-core/index";
import {
	type Api,
	type CuaModelRef,
	getCuaEnvApiKey,
	type Model,
	resolveCuaRuntimeSpec,
	type SimpleStreamOptions,
	streamSimple,
} from "@onkernel/cua-ai";
import type Kernel from "@onkernel/sdk";
import { createCuaComputerTools } from "./tools";
import type { KernelBrowser } from "./translator/translator";

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
	/** Optional caller-owned tools. Omit this to install the provider's default CUA tools. */
	tools?: AgentTool[];
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
> = Omit<AgentHarnessOptions<TSkill, TPromptTemplate, AgentTool>, "model"> & {
	/** Kernel browser session used by default CUA tools. */
	browser: KernelBrowser;
	/** Kernel SDK client used by default CUA tools. */
	client: Kernel;
	/** Model used by the harness. CUA refs are resolved before pi sees the model. */
	model: CuaRuntimeInput;
	/** Optional payload hook composed after the provider-specific CUA payload hook. */
	onPayload?: SimpleStreamOptions["onPayload"];
};

/**
 * Holds the CUA-specific pieces that have to change when a model changes.
 *
 * If callers omit `tools` or `systemPrompt`, CUA owns those values and refreshes
 * them from `@onkernel/cua-ai` whenever the model changes. If callers pass
 * their own tools or prompt, the controller preserves those caller-owned values.
 */
class CuaRuntimeController {
	private runtimeSpec: CuaRuntimeSpec;

	constructor(
		private readonly options: {
			browser: KernelBrowser;
			client: Kernel;
			model: CuaRuntimeInput;
			tools?: AgentTool[];
			systemPrompt?: unknown;
			onPayload?: SimpleStreamOptions["onPayload"];
		},
	) {
		this.runtimeSpec = resolveCuaRuntimeSpec(options.model);
	}

	get model(): Model<Api> {
		return this.runtimeSpec.model;
	}

	get ownsTools(): boolean {
		return this.options.tools === undefined;
	}

	get ownsSystemPrompt(): boolean {
		return this.options.systemPrompt === undefined;
	}

	get systemPrompt(): string {
		return this.runtimeSpec.defaultSystemPrompt;
	}

	setModel(model: CuaRuntimeInput): void {
		this.runtimeSpec = resolveCuaRuntimeSpec(model);
	}

	tools(): AgentTool[] {
		return (
			this.options.tools ??
			createCuaComputerTools({
				browser: this.options.browser,
				client: this.options.client,
				toolDefinitions: this.runtimeSpec.toolDefinitions,
			})
		);
	}

	onPayloadFor(model: CuaRuntimeInput): SimpleStreamOptions["onPayload"] {
		const runtimeSpec = resolveCuaRuntimeSpec(model);
		return composeOnPayload(runtimeSpec.onPayload, this.options.onPayload);
	}
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
	private stateProxy?: CuaAgentState;

	constructor(options: CuaAgentOptions) {
		const { browser, client, initialState, onPayload, streamFn, prepareNextTurn, ...agentOptions } = options;
		const runtime = new CuaRuntimeController({
			browser,
			client,
			model: initialState.model,
			tools: initialState.tools,
			systemPrompt: initialState.systemPrompt,
			onPayload,
		});
		const wrappedStreamFn: StreamFn = (model, context, streamOptions) =>
			(streamFn ?? streamSimple)(model, context, {
				...streamOptions,
				onPayload: runtime.onPayloadFor(model as Model<Api>),
			});

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
					systemPrompt: this.runtime.ownsSystemPrompt ? state.systemPrompt : context.systemPrompt,
					tools: this.runtime.ownsTools ? state.tools.slice() : context.tools,
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
		if (this.runtime.ownsTools) {
			state.tools = this.runtime.tools();
		}
		if (this.runtime.ownsSystemPrompt) {
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
	private readonly requestedActiveToolNames?: string[];

	constructor(options: CuaAgentHarnessOptions<TSkill, TPromptTemplate>) {
		const {
			browser,
			client,
			model,
			tools,
			systemPrompt,
			getApiKeyAndHeaders,
			onPayload,
			activeToolNames,
			...harnessOptions
		} = options;
		const runtime = new CuaRuntimeController({ browser, client, model, tools, systemPrompt, onPayload });
		const resolvedTools = runtime.tools();

		super({
			...harnessOptions,
			model: runtime.model,
			tools: resolvedTools,
			systemPrompt: systemPrompt ?? (() => runtime.systemPrompt),
			getApiKeyAndHeaders:
				getApiKeyAndHeaders ??
				(async (requestModel: Model<Api>) => {
					const apiKey = getCuaEnvApiKey(requestModel.provider);
					return apiKey ? { apiKey } : undefined;
				}),
			activeToolNames: activeToolNames ?? resolvedTools.map((tool) => tool.name),
		});

		this.runtime = runtime;
		this.requestedActiveToolNames = activeToolNames;
		this.on("before_provider_payload", async ({ model, payload }: { model: Model<Api>; payload: unknown }) => {
			const onPayload = this.runtime.onPayloadFor(model as Model<Api>);
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
		if (this.runtime.ownsTools) {
			const tools = this.runtime.tools();
			await super.setTools(tools, this.requestedActiveToolNames ?? tools.map((tool) => tool.name));
		}
		await super.setModel(this.runtime.model);
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
