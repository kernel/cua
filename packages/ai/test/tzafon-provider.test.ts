import { describe, expect, it } from "vitest";
import { tzafon } from "../src/index.js";

describe("streamTzafonResponses", () => {
	it("derives unique ids when one computer_call expands to multiple actions", () => {
		expect(tzafon.tzafonToolCallId("call_1", 0)).toBe("call_1");
		expect(tzafon.tzafonToolCallId("call_1", 1)).toBe("call_1:1");
		expect(tzafon.tzafonToolCallId("call_1", 2)).toBe("call_1:2");
	});
});
