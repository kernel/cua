import { registerApiProvider } from "@earendil-works/pi-ai";
import { OPENAI_CUA_RESPONSES_API, streamOpenAIResponses, streamSimpleOpenAIResponses } from "./providers/openai/provider";
import { streamSimpleTzafonResponses, streamTzafonResponses, TZAFON_RESPONSES_API } from "./providers/tzafon/provider";
import { streamSimpleYutori, streamYutori, YUTORI_CHAT_COMPLETIONS_API } from "./providers/yutori/provider";

// pi-ai eagerly registers openai-responses, anthropic-messages, and
// google-generative-ai when its index module loads (see
// node_modules/@earendil-works/pi-ai/dist/providers/register-builtins.js).
// CUA adds the providers pi-ai does not ship (Tzafon, Yutori) plus its own
// openai-cua-responses, which threads previous_response_id and is left
// alongside pi-ai's untouched openai-responses builtin.

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
	registerApiProvider({
		api: OPENAI_CUA_RESPONSES_API,
		stream: streamOpenAIResponses,
		streamSimple: streamSimpleOpenAIResponses,
	});
}

export { OPENAI_CUA_RESPONSES_API, streamOpenAIResponses, streamSimpleOpenAIResponses };
export { TZAFON_RESPONSES_API, streamSimpleTzafonResponses, streamTzafonResponses };
export { YUTORI_CHAT_COMPLETIONS_API, streamSimpleYutori, streamYutori };
