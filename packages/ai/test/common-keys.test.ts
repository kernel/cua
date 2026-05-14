import { describe, expect, it } from "vitest";
import {
	normalizeCuaKey,
	normalizeCuaKeyCombo,
	normalizeCuaKeySequence,
	normalizeCuaModifierKey,
} from "../src/index";

describe("canonical CUA key normalization", () => {
	it("normalizes common provider key names to X11 keysyms", () => {
		expect(normalizeCuaModifierKey("ctrl")).toBe("Control_L");
		expect(normalizeCuaModifierKey("command")).toBe("Super_L");
		expect(normalizeCuaKey("Backspace")).toBe("BackSpace");
		expect(normalizeCuaKey("ArrowLeft")).toBe("Left");
		expect(normalizeCuaKey("enter")).toBe("Return");
		expect(normalizeCuaKey("F5")).toBe("F5");
	});

	it("normalizes key combos and sequential key expressions separately", () => {
		expect(normalizeCuaKeyCombo("ctrl+shift+Tab")).toEqual(["Control_L", "Shift_L", "Tab"]);
		expect(normalizeCuaKeySequence("down down enter")).toEqual([["Down"], ["Down"], ["Return"]]);
	});
});
