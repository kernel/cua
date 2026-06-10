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
		expect(() => getCuaModel("gpt-5.5" as never)).toThrow(/provider-qualified/);
		expect(() => getCuaModel("bogus:model" as never)).toThrow(/unsupported CUA provider/);
		expect(() => getCuaModel("openai:gpt-3.5" as never)).toThrow(/unsupported CUA model/);
	});

	it("names the valid providers in the unsupported-provider error", () => {
		expect(() => parseCuaModelRef("bogus:model")).toThrow(
			'unsupported CUA provider "bogus" (expected one of: openai, anthropic, google, tzafon, yutori)',
		);
	});

	it("accepts gemini: as an alias for google:", () => {
		expect(parseCuaModelRef("gemini:gemini-3-flash-preview")).toEqual({
			provider: "google",
			model: "gemini-3-flash-preview",
		});
		const model = getCuaModel("gemini:gemini-3-flash-preview" as never);
		expect(model.provider).toBe("google");
		expect(model.id).toBe("gemini-3-flash-preview");
	});

	it("lists curated model refs without a default", () => {
		const models = listCuaModels();
		expect(models.some((model) => model.ref === "openai:gpt-5.5")).toBe(true);
		expect(models.every((model) => model.ref.includes(":"))).toBe(true);
		expect(models.some((model) => "default" in model)).toBe(false);
		expect(models.some((model) => "origin" in model)).toBe(false);
	});

	it("returns override models for refs missing from pi-ai", () => {
		const model = getCuaModel("yutori:n1.5-latest");
		expect(model.provider).toBe("yutori");
		expect(model.api).toBe("yutori-chat-completions");
	});

	it("loads supported custom provider models without explicit registration", () => {
		expect(getCuaModel("tzafon:tzafon.northstar-cua-fast").api).toBe("tzafon-responses");
		expect(getCuaModel("yutori:n1.5-latest").api).toBe("yutori-chat-completions");
	});

	it("rejects supported model IDs that are not in pi-ai or overrides", () => {
		// Matches the openai allowlist but has no pi-ai or override entry.
		expect(() => getCuaModel("openai:gpt-5.4-2099-01-01")).toThrow(
			/not registered/,
		);
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

	it("matches family roots, dated snapshots, and numeric revisions", () => {
		expect(findCuaAnnotation("openai", "gpt-5.5")?.match).toEqual({ kind: "family", family: "gpt-5.5" });
		expect(findCuaAnnotation("openai", "gpt-5.5-2026-04-23")?.match).toEqual({ kind: "family", family: "gpt-5.5" });
		expect(findCuaAnnotation("anthropic", "claude-opus-4-7")).toBeDefined();
		expect(findCuaAnnotation("anthropic", "claude-3-7-sonnet-20250219")).toBeDefined();
	});

	it("does not match adjacent families", () => {
		expect(findCuaAnnotation("openai", "gpt-5.55-foo")).toBeUndefined();
		expect(findCuaAnnotation("openai", "gpt-5.6")).toBeUndefined();
		expect(findCuaAnnotation("anthropic", "claude-3-5-sonnet")).toBeUndefined();
	});

	it("does not match named sibling variants of a family", () => {
		expect(findCuaAnnotation("openai", "gpt-5.4-mini")).toBeUndefined();
		expect(findCuaAnnotation("openai", "gpt-5.4-nano")).toBeUndefined();
		expect(findCuaAnnotation("openai", "gpt-5.4-pro")).toBeUndefined();
		expect(findCuaAnnotation("openai", "gpt-5.5-pro")).toBeUndefined();
		const openaiModels = listCuaModels("openai").map((model) => model.model);
		expect(openaiModels).not.toContain("gpt-5.4-mini");
		expect(openaiModels).not.toContain("gpt-5.4-nano");
		expect(openaiModels).not.toContain("gpt-5.4-pro");
		expect(openaiModels).toContain("gpt-5.5");
	});

	it("matches exact-id annotations", () => {
		expect(findCuaAnnotation("google", "gemini-3-flash-preview")).toBeDefined();
		expect(findCuaAnnotation("google", "gemini-3-pro-preview")).toBeDefined();
		expect(findCuaAnnotation("yutori", "n1.5-latest")).toBeDefined();
		expect(findCuaAnnotation("tzafon", "tzafon.northstar-cua-fast")).toBeDefined();
	});

	it("no longer advertises the Gemini 2.5 computer-use preview", () => {
		// The model rejects the function-declaration tools this package sends;
		// it needs Google's native tools.computer_use wrapper.
		expect(findCuaAnnotation("google", "gemini-2.5-computer-use-preview-10-2025")).toBeUndefined();
		expect(listCuaModels("google").map((model) => model.model)).not.toContain("gemini-2.5-computer-use-preview-10-2025");
		expect(() => getCuaModel("google:gemini-2.5-computer-use-preview-10-2025")).toThrow(/unsupported CUA model/);
	});
});
