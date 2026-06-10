import { describe, expect, it } from "vitest";
import { tzafon } from "../src/index.js";

describe("tzafonComputerUseOnPayload", () => {
	it("replaces local CUA action tools with the native computer_use tool", () => {
		const payload = {
			tools: [
				{ type: "function", name: "click" },
				{ type: "function", name: "screenshot" },
				{ type: "function", name: "custom_tool" },
			],
		};

		const next = tzafon.tzafonComputerUseOnPayload(payload) as { tools?: Array<{ type?: string; name?: string }> };

		expect(next.tools).toEqual([
			{
				type: "computer_use",
				display_width: 1920,
				display_height: 1080,
				environment: "browser",
			},
			{ type: "function", name: "custom_tool" },
		]);
	});

	it("preserves caller-requested keep tools", () => {
		const payload = {
			tools: [
				{ type: "function", name: "click" },
				{ type: "function", name: "batch_computer_actions" },
			],
		};

		const next = tzafon.tzafonComputerUseOnPayload(payload, undefined, {
			keepToolNames: ["batch_computer_actions"],
		}) as { tools?: Array<{ type?: string; name?: string }> };

		expect(next.tools?.map((tool) => tool.type === "computer_use" ? "computer_use" : tool.name)).toEqual([
			"computer_use",
			"batch_computer_actions",
		]);
	});

	it("returns undefined for non-object payloads", () => {
		expect(tzafon.tzafonComputerUseOnPayload(undefined)).toBeUndefined();
		expect(tzafon.tzafonComputerUseOnPayload("x")).toBeUndefined();
	});
});
