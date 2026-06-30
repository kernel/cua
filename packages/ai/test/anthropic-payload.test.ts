import { describe, expect, it } from "vitest";
import { getCuaModel } from "../src/models";
import { anthropicAdaptiveThinkingOnPayload } from "../src/providers/anthropic";

describe("anthropicAdaptiveThinkingOnPayload", () => {
	it("converts Sonnet 5 manual thinking to adaptive thinking with effort", () => {
		const payload = {
			thinking: { type: "enabled", budget_tokens: 8_192 },
			output_config: { other: true },
			messages: [],
		};

		expect(anthropicAdaptiveThinkingOnPayload(payload, getCuaModel("anthropic:claude-sonnet-5"))).toEqual({
			thinking: { type: "adaptive" },
			output_config: { other: true, effort: "medium" },
			messages: [],
		});
	});

	it("leaves older Anthropic CUA models unchanged", () => {
		const payload = { thinking: { type: "enabled", budget_tokens: 8_192 } };

		expect(anthropicAdaptiveThinkingOnPayload(payload, getCuaModel("anthropic:claude-sonnet-4-6"))).toBeUndefined();
	});

	it("maps old budget levels to supported Sonnet 5 effort levels", () => {
		const model = getCuaModel("anthropic:claude-sonnet-5");
		const effortFor = (budget_tokens: number) =>
			(anthropicAdaptiveThinkingOnPayload({ thinking: { type: "enabled", budget_tokens } }, model) as { output_config: { effort: string } })
				.output_config.effort;

		expect(effortFor(1_024)).toBe("low");
		expect(effortFor(4_096)).toBe("low");
		expect(effortFor(8_192)).toBe("medium");
		expect(effortFor(16_384)).toBe("high");
		expect(effortFor(32_768)).toBe("xhigh");
	});
});
