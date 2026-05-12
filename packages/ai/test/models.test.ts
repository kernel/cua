import { describe, expect, it } from "vitest";
import {
	CUA_MODEL_ANNOTATIONS,
	CUA_PROVIDERS,
	findCuaAnnotation,
	formatCuaModelRef,
	getCuaModel,
	listCuaModels,
	parseCuaModelRef,
} from "../src/index.js";

describe("CUA model refs", () => {
	it("parses and formats provider-qualified refs", () => {
		expect(parseCuaModelRef("openai:gpt-5.5")).toEqual({ provider: "openai", model: "gpt-5.5" });
		expect(formatCuaModelRef("yutori", "n1.5-latest")).toBe("yutori:n1.5-latest");
	});

	it("rejects unqualified and unsupported refs", () => {
		expect(() => parseCuaModelRef("gpt-5.5")).toThrow(/provider-qualified/);
		expect(() => parseCuaModelRef("bogus:model")).toThrow(/unsupported CUA provider/);
		expect(() => getCuaModel("openai:gpt-3.5" as never)).toThrow(/unsupported CUA model/);
	});

	it("lists curated model refs without a default", () => {
		const models = listCuaModels();
		expect(models.some((model) => model.ref === "openai:gpt-5.5")).toBe(true);
		expect(models.every((model) => model.ref.includes(":"))).toBe(true);
		expect(models.some((model) => "default" in model)).toBe(false);
		expect(models.some((model) => "origin" in model)).toBe(false);
	});

	it("creates dynamic models for supported refs", () => {
		const model = getCuaModel("yutori:n1.5-latest");
		expect(model.provider).toBe("yutori");
		expect(model.api).toBe("yutori-chat-completions");
	});

	it("loads supported custom provider models without explicit registration", () => {
		expect(getCuaModel("tzafon:tzafon.northstar-cua-fast").api).toBe("tzafon-responses");
		expect(getCuaModel("yutori:n1.5-latest").api).toBe("yutori-chat-completions");
	});
});

describe("CUA support annotations", () => {
	it("covers every provider", () => {
		for (const provider of CUA_PROVIDERS) {
			expect(CUA_MODEL_ANNOTATIONS[provider].length).toBeGreaterThan(0);
		}
	});

	it("cites an official source for every annotation", () => {
		for (const provider of CUA_PROVIDERS) {
			for (const annotation of CUA_MODEL_ANNOTATIONS[provider]) {
				expect(annotation.source).toMatch(/^https?:\/\//);
			}
		}
	});

	it("matches family roots and dated snapshots", () => {
		expect(findCuaAnnotation("openai", "gpt-5.5")?.match).toEqual({ kind: "family", family: "gpt-5.5" });
		expect(findCuaAnnotation("openai", "gpt-5.5-2026-04-23")?.match).toEqual({ kind: "family", family: "gpt-5.5" });
		expect(findCuaAnnotation("anthropic", "claude-opus-4-7")).toBeDefined();
	});

	it("does not match adjacent families", () => {
		expect(findCuaAnnotation("openai", "gpt-5.55-foo")).toBeUndefined();
		expect(findCuaAnnotation("openai", "gpt-5.6")).toBeUndefined();
		expect(findCuaAnnotation("anthropic", "claude-3-5-sonnet")).toBeUndefined();
	});

	it("matches exact-id annotations", () => {
		expect(findCuaAnnotation("gemini", "gemini-3-flash-preview")).toBeDefined();
		expect(findCuaAnnotation("yutori", "n1.5-latest")).toBeDefined();
		expect(findCuaAnnotation("tzafon", "tzafon.northstar-cua-fast")).toBeDefined();
	});
});
