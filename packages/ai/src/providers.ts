import { registerApiProvider } from "@earendil-works/pi-ai";
import { streamSimpleTzafonResponses, streamTzafonResponses, TZAFON_RESPONSES_API } from "./providers/tzafon/provider.js";
import { streamSimpleYutori, streamYutori, YUTORI_CHAT_COMPLETIONS_API } from "./providers/yutori/provider.js";

// pi-ai eagerly registers openai-responses, anthropic-messages, and
// google-generative-ai when its index module loads (see
// node_modules/@earendil-works/pi-ai/dist/providers/register-builtins.js).
// CUA only needs to add the providers pi-ai does not ship: Tzafon and Yutori.

/**
 * Register the Yutori and Tzafon stream providers with pi-ai's global API
 * registry. Importing `@onkernel/cua-ai` calls this automatically.
 *
 * The pi-ai registry mutators this package re-exports (`clearApiProviders`,
 * `resetApiProviders`, `unregisterApiProviders`) deregister these providers,
 * after which Yutori/Tzafon streaming fails until they are registered again.
 * Call this to restore them; it is idempotent and safe to call repeatedly.
 */
export function registerCuaProviders(): void {
	registerApiProvider({
		api: YUTORI_CHAT_COMPLETIONS_API,
		stream: streamYutori,
		streamSimple: streamSimpleYutori,
	});
	registerApiProvider({
		api: TZAFON_RESPONSES_API,
		stream: streamTzafonResponses,
		streamSimple: streamSimpleTzafonResponses,
	});
}

export { TZAFON_RESPONSES_API, streamSimpleTzafonResponses, streamTzafonResponses };
export { YUTORI_CHAT_COMPLETIONS_API, streamSimpleYutori, streamYutori };
