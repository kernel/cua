import { describe, expect, it } from "vitest";
import { DEFAULT_CUA_MODEL_REF, listSupportedModels, resolveCuaModelRef } from "../src/harness-models";

describe("resolveCuaModelRef", () => {
	it("defaults to openai:gpt-5.5", () => {
		expect(resolveCuaModelRef(undefined)).toBe(DEFAULT_CUA_MODEL_REF);
		expect(resolveCuaModelRef("")).toBe(DEFAULT_CUA_MODEL_REF);
	});

	it("passes provider-qualified refs through", () => {
		expect(resolveCuaModelRef("openai:gpt-5.5")).toBe("openai:gpt-5.5");
	});

	it("accepts bare ids when they match exactly one catalog entry", () => {
		expect(resolveCuaModelRef("gpt-5.5")).toBe("openai:gpt-5.5");
	});

	it("throws on unknown bare ids", () => {
		expect(() => resolveCuaModelRef("does-not-exist")).toThrow(/unknown model/);
	});

	it("treats 'gemini' as an alias for google when filtering", () => {
		const fromGemini = listSupportedModels("gemini");
		const fromGoogle = listSupportedModels("google");
		expect(fromGemini.map((m) => m.ref)).toEqual(fromGoogle.map((m) => m.ref));
		expect(fromGoogle.length).toBeGreaterThan(0);
	});
});
