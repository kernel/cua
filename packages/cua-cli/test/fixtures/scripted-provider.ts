import {
	type Api,
	type AssistantMessage,
	type Context,
	createAssistantMessageEventStream,
	type Model,
	registerApiProvider,
	type SimpleStreamOptions,
	unregisterApiProviders,
} from "@onkernel/cua-ai";

/** One scripted step replayed when the harness asks the provider for a turn. */
export type ScriptedStep =
	| { type: "text"; text: string }
	| { type: "tool_call"; toolName: string; args: Record<string, unknown>; id?: string }
	| { type: "error"; message: string };

export interface ScriptedTurn {
	steps: ScriptedStep[];
	/**
	 * Stop reason for the turn. Defaults to "stop" when there are no tool
	 * calls and to "toolUse" otherwise.
	 */
	stopReason?: "stop" | "toolUse" | "length";
}

export interface ScriptedProviderHandle {
	/** Reset the turn cursor; the next provider call replays the first turn. */
	reset(): void;
	/** Number of provider calls dispatched so far. */
	callCount(): number;
	/** Latest context the provider was called with (assistant-side mock). */
	lastContext(): Context | undefined;
	/** Remove the registered provider. Safe to call from `afterEach`. */
	dispose(): void;
}

const sourceCounter = { value: 0 };

/**
 * Register a scripted provider on the pi-ai api registry. The provider
 * replays one `ScriptedTurn` per provider call against the supplied API
 * id; the harness drives this exactly like a real provider.
 */
export function registerScriptedProvider(api: Api, turns: ScriptedTurn[]): ScriptedProviderHandle {
	const sourceId = `cua-cli-test-${++sourceCounter.value}`;
	const state = {
		index: 0,
		lastContext: undefined as Context | undefined,
	};
	registerApiProvider(
		{
			api,
			streamSimple: (model, context, _options?: SimpleStreamOptions) => {
				state.lastContext = context;
				const turn = turns[state.index];
				state.index += 1;
				return buildStream(model, turn);
			},
			stream: (model, context, _options) => {
				state.lastContext = context;
				const turn = turns[state.index];
				state.index += 1;
				return buildStream(model, turn);
			},
		},
		sourceId,
	);
	return {
		reset(): void {
			state.index = 0;
		},
		callCount(): number {
			return state.index;
		},
		lastContext(): Context | undefined {
			return state.lastContext;
		},
		dispose(): void {
			unregisterApiProviders(sourceId);
		},
	};
}

function buildStream(model: Model<Api>, turn: ScriptedTurn | undefined) {
	const stream = createAssistantMessageEventStream();
	void (async () => {
		const message = baseAssistantMessage(model);
		if (!turn) {
			message.stopReason = "stop";
			stream.push({ type: "start", partial: message });
			stream.push({ type: "done", reason: "stop", message });
			stream.end(message);
			return;
		}

		stream.push({ type: "start", partial: message });

		let hasToolCall = false;
		let errorStep: { message: string } | undefined;
		let contentIndex = 0;

		for (const step of turn.steps) {
			if (step.type === "text") {
				message.content.push({ type: "text", text: step.text });
				stream.push({ type: "text_start", contentIndex, partial: message });
				stream.push({ type: "text_delta", contentIndex, delta: step.text, partial: message });
				stream.push({ type: "text_end", contentIndex, content: step.text, partial: message });
				contentIndex += 1;
			} else if (step.type === "tool_call") {
				hasToolCall = true;
				const id = step.id ?? `call_${contentIndex + 1}`;
				message.content.push({
					type: "toolCall",
					id,
					name: step.toolName,
					arguments: step.args,
				});
				stream.push({ type: "toolcall_start", contentIndex, partial: message });
				stream.push({
					type: "toolcall_end",
					contentIndex,
					toolCall: { id, name: step.toolName, arguments: step.args },
					partial: message,
				});
				contentIndex += 1;
			} else if (step.type === "error") {
				errorStep = { message: step.message };
				break;
			}
		}

		if (errorStep) {
			message.stopReason = "error";
			message.errorMessage = errorStep.message;
			stream.push({ type: "error", reason: "error", error: message });
			stream.end(message);
			return;
		}

		const stopReason = turn.stopReason ?? (hasToolCall ? "toolUse" : "stop");
		message.stopReason = stopReason;
		stream.push({ type: "done", reason: stopReason, message });
		stream.end(message);
	})();
	return stream;
}

function baseAssistantMessage(model: Model<Api>): AssistantMessage {
	return {
		role: "assistant",
		content: [],
		api: model.api,
		provider: model.provider,
		model: model.id,
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "stop",
		timestamp: Date.now(),
	};
}
