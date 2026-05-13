import {
	Agent,
	type AgentOptions,
	type AgentTool,
	type AgentEvent,
	type AgentMessage,
} from "@earendil-works/pi-agent-core";
import {
	type ImageContent,
	type Api,
	type Model,
	type CuaModelRef,
	getCuaEnvApiKey,
	resolveCuaRuntimeSpec,
	streamSimple,
} from "@onkernel/cua-ai";
import type Kernel from "@onkernel/sdk";
import { createCuaComputerTools } from "./tools";
import type { KernelBrowser } from "./translator/translator";

type CuaAgentInitialState = Omit<NonNullable<AgentOptions["initialState"]>, "model" | "tools"> & {
	model: CuaModelRef | Model<Api>;
	tools?: AgentTool[];
};

export type CuaAgentOptions = Omit<AgentOptions, "initialState"> & {
	browser: KernelBrowser;
	client: Kernel;
	initialState: CuaAgentInitialState;
};

export type CuaHarnessOptions = Omit<AgentOptions, "initialState"> & {
	browser: KernelBrowser;
	client: Kernel;
	model: CuaModelRef | Model<Api>;
	tools?: AgentTool[];
	systemPrompt?: string;
};

export class CuaAgent extends Agent {
	constructor(options: CuaAgentOptions) {
		const { browser, client, initialState, onPayload, streamFn, ...agentOptions } = options;
		const runtimeSpec = resolveCuaRuntimeSpec(initialState.model);
		const tools = initialState.tools ?? createCuaComputerTools({ browser, client, toolDefinitions: runtimeSpec.toolDefinitions });
		const systemPrompt = initialState.systemPrompt ?? runtimeSpec.defaultSystemPrompt;

		super({
			...agentOptions,
			getApiKey: agentOptions.getApiKey ?? getCuaEnvApiKey,
			streamFn: streamFn ?? streamSimple,
			onPayload: composeOnPayload(runtimeSpec.onPayload, onPayload),
			initialState: {
				...initialState,
				model: runtimeSpec.model,
				tools,
				systemPrompt,
			},
		});
	}
}

export class CuaHarness {
	readonly agent: Agent;

	constructor(options: CuaHarnessOptions) {
		const { browser, client, model, tools, systemPrompt, onPayload, streamFn, ...agentOptions } = options;
		const runtimeSpec = resolveCuaRuntimeSpec(model);
		const resolvedTools = tools ?? createCuaComputerTools({ browser, client, toolDefinitions: runtimeSpec.toolDefinitions });
		this.agent = new Agent({
			...agentOptions,
			getApiKey: agentOptions.getApiKey ?? getCuaEnvApiKey,
			streamFn: streamFn ?? streamSimple,
			onPayload: composeOnPayload(runtimeSpec.onPayload, onPayload),
			initialState: {
				model: runtimeSpec.model,
				tools: resolvedTools,
				systemPrompt: systemPrompt ?? runtimeSpec.defaultSystemPrompt,
			},
		});
	}

	get state() {
		return this.agent.state;
	}

	get steeringMode() {
		return this.agent.steeringMode;
	}

	set steeringMode(mode: "all" | "one-at-a-time") {
		this.agent.steeringMode = mode;
	}

	get followUpMode() {
		return this.agent.followUpMode;
	}

	set followUpMode(mode: "all" | "one-at-a-time") {
		this.agent.followUpMode = mode;
	}

	subscribe(listener: (event: AgentEvent, signal: AbortSignal) => Promise<void> | void): () => void {
		return this.agent.subscribe(listener);
	}

	async prompt(message: AgentMessage | AgentMessage[]): Promise<void>;
	async prompt(input: string, images?: ImageContent[]): Promise<void>;
	async prompt(input: string | AgentMessage | AgentMessage[], images?: ImageContent[]): Promise<void> {
		if (typeof input === "string") {
			await this.agent.prompt(input, images);
			return;
		}
		await this.agent.prompt(input);
	}

	steer(message: AgentMessage): void {
		this.agent.steer(message);
	}

	followUp(message: AgentMessage): void {
		this.agent.followUp(message);
	}

	async continue(): Promise<void> {
		await this.agent.continue();
	}

	clearSteeringQueue(): void {
		this.agent.clearSteeringQueue();
	}

	clearFollowUpQueue(): void {
		this.agent.clearFollowUpQueue();
	}

	clearAllQueues(): void {
		this.agent.clearAllQueues();
	}

	abort(): void {
		this.agent.abort();
	}

	async waitForIdle(): Promise<void> {
		await this.agent.waitForIdle();
	}

	getTranscript(): AgentMessage[] {
		return [...this.agent.state.messages];
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
