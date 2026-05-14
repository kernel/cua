import { describe, expect, it } from "vitest";
import { yutori } from "../src/index";

describe("Yutori native action normalization", () => {
	it("normalizes n1/n1.5 click actions to canonical individual actions", () => {
		expect(yutori.toCanonicalActions("left_click", { coordinates: [500, 250] })).toEqual([
			{ type: "click", x: 500, y: 250 },
		]);
		expect(yutori.toCanonicalActions("double_click", { coordinates: [500, 250] })).toEqual([
			{ type: "double_click", x: 500, y: 250 },
		]);
		expect(yutori.toCanonicalActions("triple_click", { coordinates: [500, 250] })).toEqual([
			{ type: "double_click", x: 500, y: 250 },
			{ type: "click", x: 500, y: 250 },
		]);
		expect(yutori.toCanonicalActions("middle_click", { coordinates: [500, 250] })).toEqual([
			{ type: "click", x: 500, y: 250, button: "middle" },
		]);
	});

	it("normalizes mouse, drag, type, and keyboard actions", () => {
		expect(yutori.toCanonicalActions("mouse_move", { coordinates: [100, 200] })).toEqual([
			{ type: "move", x: 100, y: 200 },
		]);
		expect(yutori.toCanonicalActions("drag", { start_coordinates: [100, 200], coordinates: [300, 400] })).toEqual([
			{ type: "drag", path: [{ x: 100, y: 200 }, { x: 300, y: 400 }], button: "left" },
		]);
		expect(yutori.toCanonicalActions("type", { text: "hello", clear_before_typing: true, press_enter_after: true })).toEqual([
			{ type: "keypress", keys: ["Control", "a"] },
			{ type: "keypress", keys: ["Backspace"] },
			{ type: "type", text: "hello" },
			{ type: "keypress", keys: ["Enter"] },
		]);
		expect(yutori.toCanonicalActions("hold_key", { key: "Shift", duration: 1.5 })).toEqual([
			{ type: "keypress", keys: ["Shift"], duration: 1500 },
		]);
	});

	it("normalizes scroll and navigation actions", () => {
		expect(yutori.toCanonicalActions("scroll", { coordinates: [500, 500], direction: "down", amount: 3 })).toEqual([
			{ type: "scroll", x: 500, y: 500, scroll_x: 0, scroll_y: 360 },
		]);
		expect(yutori.toCanonicalActions("goto_url", { url: "https://example.com" })).toEqual([
			{ type: "goto", url: "https://example.com" },
			{ type: "wait", ms: 2000 },
		]);
		expect(yutori.toCanonicalActions("refresh", {})).toEqual([
			{ type: "keypress", keys: ["F5"] },
			{ type: "wait", ms: 2000 },
		]);
	});
});
