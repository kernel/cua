import type { Agent, AgentEvent } from "@onkernel/cua-agent";
import type { CuaAgentHandle } from "../agent";
import { promptWithScreenshot } from "../agent-prompt";

export type InteractiveDriverListener = (event: AgentEvent) => void | Promise<void>;

export interface InteractiveDriver {
	subscribe(listener: InteractiveDriverListener): () => void;
	submit(prompt: string): Promise<void>;
	abort(): void;
	isStreaming(): boolean;
	dispose(): Promise<void>;
}

export class LiveInteractiveDriver implements InteractiveDriver {
	readonly agent: Agent;
	private firstPrompt = true;

	constructor(
		private readonly handle: CuaAgentHandle,
		private readonly options: {
			skipInitialScreenshot?: boolean;
		} = {},
	) {
		this.agent = handle.agent;
	}

	subscribe(listener: InteractiveDriverListener): () => void {
		return this.handle.agent.subscribe((event) => listener(event));
	}

	async submit(prompt: string): Promise<void> {
		const skipInitialScreenshot = this.options.skipInitialScreenshot === true && this.firstPrompt;
		this.firstPrompt = false;

		await promptWithScreenshot({
			agent: this.handle.agent,
			translator: this.handle.translator,
			prompt,
			options: { skipInitialScreenshot },
		});
	}

	abort(): void {
		this.handle.agent.abort();
	}

	isStreaming(): boolean {
		return this.handle.agent.state.isStreaming;
	}

	async dispose(): Promise<void> {
		await this.handle.dispose();
	}
}
