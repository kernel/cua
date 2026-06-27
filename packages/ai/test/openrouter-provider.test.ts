import { describe, expect, it } from "vitest";
import { openrouter } from "../src/index";

describe("OpenRouter provider normalization", () => {
	it("unwraps GLM-V coordinate arrays on canonical actions", () => {
		const action = {
			type: "click",
			x: [929, 294],
			y: [294, 294],
		} as unknown as openrouter.OpenRouterAction;

		expect(openrouter.normalizeOpenRouterAction(action)).toEqual({ type: "click", x: 929, y: 294 });
	});

	it("does not copy scalar x into missing y coordinates", () => {
		const action = {
			type: "click",
			x: 929,
		} as unknown as openrouter.OpenRouterAction;

		expect(() => openrouter.normalizeOpenRouterAction(action)).toThrow("invalid OpenRouter click coordinates");
	});

	it("applies the coordinate normalization through tool executors", () => {
		const click = openrouter.computerToolExecutors({ actions: ["click"] })[0]!;
		expect(click.toActions({ x: [929, 294], y: [294, 294] })).toEqual([{ type: "click", x: 929, y: 294 }]);
	});

	it("rejects unparseable coordinate arrays before execution", () => {
		const click = openrouter.computerToolExecutors({ actions: ["click"] })[0]!;
		expect(() => click.toActions({ x: ["929"], y: ["294"] })).toThrow("invalid OpenRouter click coordinates");
	});
});
