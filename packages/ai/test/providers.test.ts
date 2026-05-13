import { describe, expect, it } from "vitest";
import { getApiProvider, tzafon, yutori } from "../src/index";

const TZAFON_RESPONSES_API = tzafon.TZAFON_RESPONSES_API;
const YUTORI_CHAT_COMPLETIONS_API = yutori.YUTORI_CHAT_COMPLETIONS_API;

describe("CUA provider registration", () => {
	it("registers Tzafon and Yutori APIs that pi-ai does not ship", () => {
		expect(getApiProvider(YUTORI_CHAT_COMPLETIONS_API)).toBeDefined();
		expect(getApiProvider(TZAFON_RESPONSES_API)).toBeDefined();
	});

	it("leaves pi-ai built-ins registered for the providers CUA targets", () => {
		expect(getApiProvider("openai-responses")).toBeDefined();
		expect(getApiProvider("anthropic-messages")).toBeDefined();
		expect(getApiProvider("google-generative-ai")).toBeDefined();
	});

	it("exposes a stream function on every CUA-target API", () => {
		for (const api of [
			"openai-responses",
			"anthropic-messages",
			"google-generative-ai",
			YUTORI_CHAT_COMPLETIONS_API,
			TZAFON_RESPONSES_API,
		] as const) {
			const provider = getApiProvider(api);
			expect(provider?.stream).toBeTypeOf("function");
			expect(provider?.streamSimple).toBeTypeOf("function");
		}
	});
});
