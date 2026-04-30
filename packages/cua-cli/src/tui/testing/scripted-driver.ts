import type { AgentEvent } from "@mariozechner/pi-agent-core";
import type { AssistantMessage, Usage } from "@mariozechner/pi-ai";
import type { InteractiveDriver, InteractiveDriverListener } from "../driver.js";

export interface FixturePromptMatch {
	equals?: string;
	regex?: string;
}

export type FixtureStep =
	| { type: "sleep"; ms: number }
	| { type: "assistant_text"; text: string; chunkSize?: number; chunkMs?: number }
	| { type: "assistant_error"; message: string }
	| { type: "tool_start"; toolName: string; args?: unknown }
	| { type: "tool_end"; toolName: string; result?: unknown; isError?: boolean }
	| { type: "await_abort" };

export interface FixtureInteraction {
	match: FixturePromptMatch;
	steps: FixtureStep[];
}

export interface ScriptedFixture {
	model?: string;
	browserSession?: string;
	liveUrl?: string;
	interactions: FixtureInteraction[];
}

export class ScriptedDriver implements InteractiveDriver {
	private readonly listeners = new Set<InteractiveDriverListener>();
	private currentAbort: AbortController | undefined;
	private streaming = false;
	private nextToolCallId = 1;

	constructor(private readonly fixture: ScriptedFixture) {}

	subscribe(listener: InteractiveDriverListener): () => void {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}

	async submit(prompt: string): Promise<void> {
		if (this.streaming) {
			throw new Error("scripted driver is already handling a prompt");
		}

		const interaction = this.fixture.interactions.find((candidate) => matchesPrompt(candidate.match, prompt));
		if (!interaction) {
			throw new Error(`no scripted fixture matched prompt: ${JSON.stringify(prompt)}`);
		}

		this.streaming = true;
		this.currentAbort = new AbortController();
		const signal = this.currentAbort.signal;
		const startedAt = Date.now();
		let assistantText = "";
		let assistantStarted = false;

		const message = (): AssistantMessage => buildAssistantMessage(assistantText, startedAt);
	const errorMessage = (text: string): AssistantMessage => buildAssistantErrorMessage(text, startedAt);

		await this.emit({ type: "agent_start" });
		try {
			for (const step of interaction.steps) {
				if (signal.aborted) {
					break;
				}

				switch (step.type) {
					case "sleep":
						await delay(step.ms, signal);
						break;
					case "assistant_text": {
						if (!assistantStarted) {
							assistantStarted = true;
							await this.emit({ type: "message_start", message: message() });
						}
						const chunkSize = Math.max(1, step.chunkSize ?? step.text.length);
						for (const chunk of chunkText(step.text, chunkSize)) {
							assistantText += chunk;
							const partial = message();
							await this.emit({
								type: "message_update",
								message: partial,
								assistantMessageEvent: {
									type: "text_delta",
									contentIndex: 0,
									delta: chunk,
									partial,
								},
							});
							if (step.chunkMs && step.chunkMs > 0) {
								await delay(step.chunkMs, signal);
							}
							if (signal.aborted) {
								break;
							}
						}
						break;
					}
					case "assistant_error": {
						assistantStarted = true;
						const errMessage = errorMessage(step.message);
						await this.emit({ type: "message_start", message: errMessage });
						await this.emit({ type: "message_end", message: errMessage });
						await this.emit({ type: "agent_end", messages: [errMessage] });
						return;
					}
					case "tool_start": {
						const toolCallId = `fixture-tool-${this.nextToolCallId++}`;
						await this.emit({
							type: "tool_execution_start",
							toolCallId,
							toolName: step.toolName,
							args: step.args ?? {},
						});
						break;
					}
					case "tool_end": {
						const toolCallId = `fixture-tool-${this.nextToolCallId++}`;
						await this.emit({
							type: "tool_execution_end",
							toolCallId,
							toolName: step.toolName,
							result:
								step.result ?? {
									content: [{ type: "text", text: step.isError ? "error" : "ok" }],
									details: {},
								},
							isError: step.isError ?? false,
						});
						break;
					}
					case "await_abort":
						await waitForAbort(signal);
						break;
				}
			}
		} finally {
			if (assistantStarted) {
				await this.emit({ type: "message_end", message: message() });
			}
			await this.emit({
				type: "agent_end",
				messages: assistantStarted ? [message()] : [],
			});
			this.streaming = false;
			this.currentAbort = undefined;
		}
	}

	abort(): void {
		this.currentAbort?.abort();
	}

	isStreaming(): boolean {
		return this.streaming;
	}

	async dispose(): Promise<void> {
		this.abort();
	}

	private async emit(event: AgentEvent): Promise<void> {
		for (const listener of this.listeners) {
			await listener(event);
		}
	}
}

function matchesPrompt(match: FixturePromptMatch, prompt: string): boolean {
	if (match.equals !== undefined) {
		return prompt === match.equals;
	}
	if (match.regex !== undefined) {
		return new RegExp(match.regex, "u").test(prompt);
	}
	return false;
}

function chunkText(text: string, chunkSize: number): string[] {
	const chunks: string[] = [];
	for (let index = 0; index < text.length; index += chunkSize) {
		chunks.push(text.slice(index, index + chunkSize));
	}
	return chunks.length > 0 ? chunks : [""];
}

async function delay(ms: number, signal: AbortSignal): Promise<void> {
	if (signal.aborted || ms <= 0) {
		return;
	}
	await new Promise<void>((resolve) => {
		const timer = setTimeout(() => {
			cleanup();
			resolve();
		}, ms);
		const cleanup = () => {
			clearTimeout(timer);
			signal.removeEventListener("abort", onAbort);
		};
		const onAbort = () => {
			cleanup();
			resolve();
		};
		signal.addEventListener("abort", onAbort, { once: true });
	});
}

async function waitForAbort(signal: AbortSignal): Promise<void> {
	if (signal.aborted) {
		return;
	}
	await new Promise<void>((resolve) => {
		signal.addEventListener("abort", () => resolve(), { once: true });
	});
}

const ZERO_USAGE: Usage = {
	input: 0,
	output: 0,
	cacheRead: 0,
	cacheWrite: 0,
	totalTokens: 0,
	cost: {
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		total: 0,
	},
};

function buildAssistantMessage(text: string, timestamp: number): AssistantMessage {
	return {
		role: "assistant",
		content: text ? [{ type: "text", text }] : [],
		api: "fixture",
		provider: "fixture",
		model: "fixture-model",
		usage: ZERO_USAGE,
		stopReason: "stop",
		timestamp,
	};
}

function buildAssistantErrorMessage(message: string, timestamp: number): AssistantMessage {
	return {
		...buildAssistantMessage("", timestamp),
		stopReason: "error",
		errorMessage: message,
	};
}
