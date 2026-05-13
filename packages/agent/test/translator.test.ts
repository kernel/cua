import { describe, expect, it } from "vitest";
import type Kernel from "@onkernel/sdk";
import { InternalComputerTranslator, type KernelBrowser } from "../src/translator/translator";

const browser = { session_id: "browser_123" } as KernelBrowser;

function createClient() {
	const batches: unknown[] = [];
	const client = {
		browsers: {
			computer: {
				batch: async (_id: string, body: { actions: unknown[] }) => {
					batches.push(body.actions);
				},
				readClipboard: async () => ({ text: "https://example.com/" }),
			},
		},
	} as unknown as Kernel;
	return { batches, client };
}

describe("InternalComputerTranslator", () => {
	it("holds modifiers instead of typing shortcut keys", async () => {
		const { batches, client } = createClient();
		const translator = new InternalComputerTranslator({ browser, client });

		await translator.executeBatch([
			{ type: "goto", url: "https://example.com" },
			{ type: "url" },
			{ type: "keypress", keys: ["ctrl", "shift", "Tab"] },
		]);

		expect(batches).toEqual([
			[
				{ type: "press_key", press_key: { keys: ["l"], hold_keys: ["Control_L"] } },
				{ type: "type_text", type_text: { text: "https://example.com" } },
				{ type: "press_key", press_key: { keys: ["Return"] } },
			],
			[
				{ type: "press_key", press_key: { keys: ["l"], hold_keys: ["Control_L"] } },
				{ type: "press_key", press_key: { keys: ["c"], hold_keys: ["Control_L"] } },
			],
			[
				{ type: "press_key", press_key: { keys: ["Tab"], hold_keys: ["Control_L", "Shift_L"] } },
			],
		]);
	});

	it("accepts shortcut strings from provider adapters", async () => {
		const { batches, client } = createClient();
		const translator = new InternalComputerTranslator({ browser, client });

		await translator.executeBatch([{ type: "keypress", keys: ["Ctrl+L"] }]);

		expect(batches).toEqual([
			[{ type: "press_key", press_key: { keys: ["l"], hold_keys: ["Control_L"] } }],
		]);
	});
});
