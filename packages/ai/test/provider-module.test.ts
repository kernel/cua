import { describe, expect, it } from "vitest";
import { anthropic, CUA_PROVIDERS, type CuaProvider, gemini, openai, tzafon, yutori } from "../src/index.js";
import type { CuaProviderModule } from "../src/providers/common.js";

const MODULES: Record<CuaProvider, { providerModule: CuaProviderModule }> = {
	openai,
	anthropic,
	google: gemini,
	tzafon,
	yutori,
};

describe("provider modules satisfy the uniform contract", () => {
	for (const provider of CUA_PROVIDERS) {
		it(`${provider} conforms to CuaProviderModule`, () => {
			const mod = MODULES[provider].providerModule;

			expect(mod.toolDefinitions).toBeTypeOf("function");
			expect(mod.toolExecutors).toBeTypeOf("function");
			expect(mod.coordinateSystem).toBeTypeOf("function");
			expect(mod.buildSystemPrompt).toBeTypeOf("function");

			expect(Array.isArray(mod.toolDefinitions())).toBe(true);

			const executors = mod.toolExecutors();
			expect(Array.isArray(executors)).toBe(true);
			expect(executors.length).toBeGreaterThan(0);

			const coordinates = mod.coordinateSystem();
			if (coordinates.type === "pixel") {
				expect(coordinates).toEqual({ type: "pixel" });
			} else {
				expect(coordinates.type).toBe("normalized");
				expect(coordinates.range).toHaveLength(2);
				expect(coordinates.range[0]).toBeTypeOf("number");
				expect(coordinates.range[1]).toBeTypeOf("number");
			}

			expect(mod.buildSystemPrompt()).toBeTypeOf("string");
		});
	}

	it("yutori sends no model-facing tool definitions", () => {
		expect(yutori.providerModule.toolDefinitions()).toEqual([]);
	});
});
