import { completeSimple, getCuaEnvApiKeyForModel, getCuaModel, type CuaModelRef } from "@onkernel/cua-ai";
import type { JudgeContent, JudgeModel } from "../types";

/** A {@link JudgeModel} backed by pi-ai's `completeSimple`, resolving the provider and key from a CUA model ref. */
export function piJudgeModel(ref: CuaModelRef): JudgeModel {
	const model = getCuaModel(ref);
	return {
		async complete(systemPrompt, content) {
			const apiKey = getCuaEnvApiKeyForModel(ref);
			const res = await completeSimple(
				model,
				{ systemPrompt, messages: [{ role: "user", content, timestamp: Date.now() }] },
				{ apiKey, temperature: 0, maxTokens: 1024 },
			);
			return res.content.flatMap((c) => (c.type === "text" ? [c.text] : [])).join("");
		},
	};
}

export type { JudgeContent };
