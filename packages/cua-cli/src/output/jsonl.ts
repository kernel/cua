import type { Agent, AgentEvent } from "@mariozechner/pi-agent-core";
import type { BrowserSession } from "@onkernel/cua-translator";

export interface JsonlSinkOptions {
	browser: BrowserSession;
	modelId: string;
	provider: string;
	/** Where to write each line (default: process.stdout). */
	write?: (line: string) => void;
	/** When false (default), assistant_text_delta events are suppressed. */
	includeDeltas?: boolean;
	/** When true, include base64 image content for screenshots in tool_result events. Default false. */
	includeImages?: boolean;
}

interface JsonlEventBase {
	type: string;
	ts: number;
}

/**
 * Subscribe to an agent's lifecycle and emit one JSON object per line for
 * downstream tooling. The schema is intentionally compact and stable so
 * shell scripts can consume it without extra transformation.
 */
export function attachJsonlSink(agent: Agent, opts: JsonlSinkOptions): () => void {
	const write = opts.write ?? ((line: string) => process.stdout.write(line + "\n"));
	const emit = (obj: JsonlEventBase & Record<string, unknown>): void => {
		try {
			write(JSON.stringify(obj));
		} catch {
			write(
				JSON.stringify({
					type: "error",
					code: "serialize_failed",
					message: "could not serialize event",
					ts: Date.now(),
				}),
			);
		}
	};

	emit({
		type: "session_created",
		model: opts.modelId,
		provider: opts.provider,
		ts: Date.now(),
	});
	emit({
		type: "browser_created",
		browser_session_id: opts.browser.sessionId,
		live_url: opts.browser.liveUrl,
		profile_id: opts.browser.profileId,
		ts: Date.now(),
	});

	let turn = 0;
	const includeDeltas = opts.includeDeltas === true;
	const includeImages = opts.includeImages === true;

	return agent.subscribe((event: AgentEvent) => {
		switch (event.type) {
			case "turn_start":
				turn += 1;
				return;
			case "turn_end":
				emit({ type: "turn_done", turn, ts: Date.now() });
				return;
			case "agent_end":
				emit({ type: "run_complete", turns: turn, ts: Date.now() });
				return;
			case "message_end": {
				const msg = event.message;
				if (msg.role === "user") {
					const text = textOf(msg.content);
					emit({ type: "user_message", text, ts: Date.now() });
				} else if (msg.role === "assistant") {
					const text = textOf(msg.content);
					if (text) emit({ type: "assistant_text_done", text, ts: Date.now() });
				}
				return;
			}
			case "message_update": {
				if (!includeDeltas) return;
				if (event.assistantMessageEvent.type === "text_delta") {
					emit({
						type: "assistant_text_delta",
						delta: event.assistantMessageEvent.delta,
						ts: Date.now(),
					});
				}
				return;
			}
			case "tool_execution_start":
				emit({
					type: "tool_call",
					tool_name: event.toolName,
					call_id: event.toolCallId,
					args: event.args,
					ts: Date.now(),
				});
				return;
			case "tool_execution_end": {
				const result = event.result as
					| {
							content?: Array<{ type?: string; text?: string; data?: string; mimeType?: string }>;
							details?: unknown;
					  }
					| undefined;
				const ok = !event.isError;
				let contentText: string | undefined;
				let screenshotBytes: number | undefined;
				const screenshotsB64: string[] = [];
				if (result?.content) {
					const textParts: string[] = [];
					for (const c of result.content) {
						if (c?.type === "text" && typeof c.text === "string") textParts.push(c.text);
						if (c?.type === "image" && typeof c.data === "string") {
							const len = c.data.length;
							screenshotBytes = (screenshotBytes ?? 0) + len;
							if (includeImages) screenshotsB64.push(c.data);
						}
					}
					contentText = textParts.join("\n").trim() || undefined;
				}
				emit({
					type: "tool_result",
					tool_name: event.toolName,
					call_id: event.toolCallId,
					ok,
					content_text: contentText,
					screenshot_bytes: screenshotBytes,
					...(includeImages && screenshotsB64.length ? { screenshots_b64: screenshotsB64 } : {}),
					details: result?.details,
					ts: Date.now(),
				});
				return;
			}
			default:
				return;
		}
	});
}

function textOf(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	const parts: string[] = [];
	for (const c of content) {
		if (
			c &&
			typeof c === "object" &&
			(c as { type?: unknown }).type === "text" &&
			typeof (c as { text?: unknown }).text === "string"
		) {
			parts.push((c as { text: string }).text);
		}
	}
	return parts.join("\n");
}
