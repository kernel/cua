import type { StreamFn } from "@mariozechner/pi-agent-core";
import {
	registerApiProvider,
	streamAnthropic,
	streamSimpleAnthropic,
} from "@mariozechner/pi-ai";
import { ANTHROPIC_COMPUTER_USE_BETA } from "./official.js";

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
 * Wrap a `StreamFn` so that Anthropic requests carry the computer-use
 * beta header (`computer-use-2025-11-24`) merged with whatever beta
 * tokens pi-ai is already sending (e.g. fine-grained tool streaming).
 *
 * Other providers (OpenAI etc.) pass through unchanged.
 *
 * The Anthropic API accepts comma-separated beta tokens in a single
 * header. pi-ai's `mergeHeaders` is "later wins", so to keep both we
 * compose the combined value here and overwrite.
 */
export function wrapAnthropicStream(base: StreamFn): StreamFn {
	return ((model, context, options) => {
		if (model.api !== "anthropic-messages") {
			return base(model, context, options);
		}
		const existing = options?.headers?.["anthropic-beta"];
		const merged = combineBetas(existing, ANTHROPIC_COMPUTER_USE_BETA, "fine-grained-tool-streaming-2025-05-14");
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
