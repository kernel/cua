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

	it("applies the coordinate normalization through tool executors", () => {
		const click = openrouter.computerToolExecutors({ actions: ["click"] })[0]!;
		expect(click.toActions({ x: [929, 294], y: [294, 294] })).toEqual([{ type: "click", x: 929, y: 294 }]);
	});
});
