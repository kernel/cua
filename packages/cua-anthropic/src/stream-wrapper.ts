import type { StreamFn } from "@mariozechner/pi-agent-core";
import {
	registerApiProvider,
	streamAnthropic,
	streamSimpleAnthropic,
} from "@mariozechner/pi-ai";
import {
	ANTHROPIC_COMPACTION_BETA,
	anthropicComputerUseBetaForModel,
	anthropicSupportsCompaction,
} from "./official.js";
import type { AnthropicContextManagementOptions } from "./payload-hook.js";

/**
 * Eagerly register the Anthropic Messages provider with `pi-ai`. pi-ai
 * lazily resolves provider implementations via dynamic import which can
 * fail under bundlers; calling this once at module load time is the safe
 * pattern. Idempotent.
 */
let registered = false;
export function registerAnthropicProvider(): void {
	if (registered) return;
	registerApiProvider({
		api: "anthropic-messages",
		stream: streamAnthropic,
		streamSimple: streamSimpleAnthropic,
	});
	registered = true;
}

/**
 * Wrap a `StreamFn` so that Anthropic requests carry the model-compatible
 * computer-use beta header merged with whatever beta tokens pi-ai is
 * already sending (e.g. fine-grained tool streaming).
 *
 * Other providers (OpenAI etc.) pass through unchanged.
 *
 * The Anthropic API accepts comma-separated beta tokens in a single
 * header. pi-ai's `mergeHeaders` is "later wins", so to keep both we
 * compose the combined value here and overwrite.
 */
export function wrapAnthropicStream(base: StreamFn, opts: AnthropicContextManagementOptions = {}): StreamFn {
	return ((model, context, options) => {
		if (model.api !== "anthropic-messages") {
			return base(model, context, options);
		}
		const existing = options?.headers?.["anthropic-beta"];
		const computerBeta = anthropicComputerUseBetaForModel(model.id);
		const compactionBeta =
			opts.compactThreshold !== false && anthropicSupportsCompaction(model.id)
				? ANTHROPIC_COMPACTION_BETA
				: undefined;
		const merged = combineBetas(existing, computerBeta, compactionBeta, "fine-grained-tool-streaming-2025-05-14");
		const nextOptions = {
			...options,
			headers: {
				...(options?.headers ?? {}),
				"anthropic-beta": merged,
			},
		};
		return base(model, context, nextOptions);
	}) as StreamFn;
}

function combineBetas(...values: Array<string | undefined>): string {
	const seen = new Set<string>();
	for (const v of values) {
		if (!v) continue;
		for (const tok of v.split(",")) {
			const t = tok.trim();
			if (t) seen.add(t);
		}
	}
	return [...seen].join(",");
}
