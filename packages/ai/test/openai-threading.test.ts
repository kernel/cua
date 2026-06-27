import { afterEach, describe, expect, it } from "vitest";
import type { Context, Message, Model } from "@earendil-works/pi-ai";
import { openai } from "../src/index";

const model = { id: "gpt-5.5", maxTokens: 32_768 } as Model<typeof openai.OPENAI_CUA_RESPONSES_API>;

const TURNS = 6;

/** Build a multi-turn context where each assistant turn carries a distinct responseId followed by a screenshot tool result. */
function multiTurnContext(): Context {
	const messages: Message[] = [{ role: "user", content: "book a flight", timestamp: 0 }];
	for (let turn = 0; turn < TURNS; turn += 1) {
		messages.push({
			role: "assistant",
			content: [{ type: "toolCall", id: `call_${turn}`, name: "click", arguments: { x: turn, y: turn } }],
			api: openai.OPENAI_CUA_RESPONSES_API,
			provider: "openai",
			model: model.id,
			responseId: `resp_${turn}`,
			usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
			stopReason: "toolUse",
			timestamp: 0,
		});
		messages.push({
			role: "toolResult",
			toolCallId: `call_${turn}`,
			toolName: "click",
			content: [{ type: "image", mimeType: "image/png", data: `screenshot-${turn}` }],
			isError: false,
			timestamp: 0,
		});
	}
	return { messages, tools: [], systemPrompt: "control the browser" };
}

/** Collect every input_image data URL the request carries, across user content and function_call_output content. */
function screenshotImageUrls(input: Array<Record<string, unknown>>): string[] {
	const urls: string[] = [];
	const scan = (content: unknown) => {
		if (!Array.isArray(content)) return;
		for (const part of content) {
			if (part && typeof part === "object" && (part as { type?: string }).type === "input_image") {
				urls.push((part as { image_url: string }).image_url);
			}
		}
	};
	for (const item of input) {
		scan(item.content);
		scan(item.output);
	}
	return urls;
}

describe("buildOpenAIRequestInput response threading", () => {
	afterEach(() => {
		delete process.env.CUA_DISABLE_RESPONSE_THREADING;
	});

	// Threading ON is the fix: chain via previous_response_id and send only the
	// latest screenshot. OFF replays every screenshot — the per-turn growth that
	// inflates the request before previous_response_id continuity was added.
	it("threads the latest delta when enabled (default)", () => {
		const body = openai.buildOpenAIRequestInput(model, multiTurnContext());
		const screenshots = screenshotImageUrls(body.input);

		expect(screenshots).toHaveLength(1);
		expect(screenshots[0]).toBe(`data:image/png;base64,screenshot-${TURNS - 1}`);
		expect(body.previous_response_id).toBe(`resp_${TURNS - 1}`);
		// store is always true for the public Responses API (required for previous_response_id).
		expect(body.store).toBe(true);
	});

	it("replays the full screenshot history when threading is disabled by option (locks the failure mode)", () => {
		const body = openai.buildOpenAIRequestInput(model, multiTurnContext(), { disableResponseThreading: true });
		const screenshots = screenshotImageUrls(body.input);

		expect(screenshots).toHaveLength(TURNS);
		expect(screenshots).toEqual(Array.from({ length: TURNS }, (_, turn) => `data:image/png;base64,screenshot-${turn}`));
		expect(body.previous_response_id).toBeUndefined();
	});

	it("replays the full screenshot history when CUA_DISABLE_RESPONSE_THREADING is set", () => {
		process.env.CUA_DISABLE_RESPONSE_THREADING = "1";
		const body = openai.buildOpenAIRequestInput(model, multiTurnContext());

		expect(screenshotImageUrls(body.input)).toHaveLength(TURNS);
		expect(body.previous_response_id).toBeUndefined();
	});

	it("falls back to full history when no prior turn carries a responseId", () => {
		const context = multiTurnContext();
		for (const message of context.messages) {
			if (message.role === "assistant") delete message.responseId;
		}

		const body = openai.buildOpenAIRequestInput(model, context);
		expect(screenshotImageUrls(body.input)).toHaveLength(TURNS);
		expect(body.previous_response_id).toBeUndefined();
	});

	// Off-path screenshot count scales with turn count; on-path stays constant at one.
	it("grows the payload per turn when off but stays flat when on", () => {
		const counts = (turns: number, disable: boolean) => {
			const messages: Message[] = [{ role: "user", content: "task", timestamp: 0 }];
			for (let turn = 0; turn < turns; turn += 1) {
				messages.push({
					role: "assistant",
					content: [{ type: "toolCall", id: `c_${turn}`, name: "click", arguments: {} }],
					api: openai.OPENAI_CUA_RESPONSES_API,
					provider: "openai",
					model: model.id,
					responseId: `r_${turn}`,
					usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
					stopReason: "toolUse",
					timestamp: 0,
				});
				messages.push({
					role: "toolResult",
					toolCallId: `c_${turn}`,
					toolName: "click",
					content: [{ type: "image", mimeType: "image/png", data: `s-${turn}` }],
					isError: false,
					timestamp: 0,
				});
			}
			const body = openai.buildOpenAIRequestInput(model, { messages, tools: [] }, { disableResponseThreading: disable });
			return screenshotImageUrls(body.input).length;
		};

		expect(counts(3, true)).toBe(3);
		expect(counts(8, true)).toBe(8);
		expect(counts(3, false)).toBe(1);
		expect(counts(8, false)).toBe(1);
	});
});
