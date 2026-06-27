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

	it("does not copy scalar x into missing y", () => {
		const action = {
			type: "click",
			x: 929,
		} as unknown as openrouter.OpenRouterAction;

		expect(() => openrouter.normalizeOpenRouterAction(action)).toThrow(/missing a finite y coordinate/);
	});

	it("rejects invalid coordinate arrays for required actions", () => {
		const action = {
			type: "click",
			x: ["bad", "data"],
			y: ["still", "bad"],
		} as unknown as openrouter.OpenRouterAction;

		expect(() => openrouter.normalizeOpenRouterAction(action)).toThrow(/missing a finite x coordinate/);
	});

	it("drops invalid scroll coordinate arrays instead of passing arrays through", () => {
		const action = {
			type: "scroll",
			x: ["bad", "data"],
			y: ["still", "bad"],
			scroll_y: 120,
		} as unknown as openrouter.OpenRouterAction;

		expect(openrouter.normalizeOpenRouterAction(action)).toEqual({
			type: "scroll",
			x: undefined,
			y: undefined,
			scroll_y: 120,
		});
	});

	it("applies the coordinate normalization through tool executors", () => {
		const click = openrouter.computerToolExecutors({ actions: ["click"] })[0]!;
		expect(click.toActions({ x: [929, 294], y: [294, 294] })).toEqual([{ type: "click", x: 929, y: 294 }]);
	});
});
