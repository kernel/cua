import { registerApiProvider } from "@earendil-works/pi-ai";
import { streamSimpleTzafonResponses, streamTzafonResponses, TZAFON_RESPONSES_API } from "./providers/tzafon/provider";
import { streamSimpleYutori, streamYutori, YUTORI_CHAT_COMPLETIONS_API } from "./providers/yutori/provider";

let registered = false;

// pi-ai eagerly registers openai-responses, anthropic-messages, and
// google-generative-ai when its index module loads (see
// node_modules/@earendil-works/pi-ai/dist/providers/register-builtins.js).
// CUA only needs to add the providers pi-ai does not ship: Tzafon and Yutori.
export function registerCuaProviders(): void {
	if (registered) return;
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
	registered = true;
}

export { TZAFON_RESPONSES_API, streamSimpleTzafonResponses, streamTzafonResponses };
export { YUTORI_CHAT_COMPLETIONS_API, streamSimpleYutori, streamYutori };
