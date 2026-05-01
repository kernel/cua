import { registerApiProvider } from "@mariozechner/pi-ai";
import { streamAnthropic, streamSimpleAnthropic } from "@mariozechner/pi-ai/anthropic";
import { streamGoogle, streamSimpleGoogle } from "@mariozechner/pi-ai/google";
import { streamOpenAIResponses, streamSimpleOpenAIResponses } from "@mariozechner/pi-ai/openai-responses";
import { streamSimpleTzafonResponses, streamTzafonResponses, TZAFON_RESPONSES_API } from "./providers/tzafon/provider.js";
import { streamSimpleYutori, streamYutori, YUTORI_CHAT_COMPLETIONS_API } from "./providers/yutori/provider.js";

let registered = false;

export function registerCuaProviders(): void {
	if (registered) return;
	registerApiProvider({
		api: "openai-responses",
		stream: streamOpenAIResponses,
		streamSimple: streamSimpleOpenAIResponses,
	});
	registerApiProvider({
		api: "anthropic-messages",
		stream: streamAnthropic,
		streamSimple: streamSimpleAnthropic,
	});
	registerApiProvider({
		api: "google-generative-ai",
		stream: streamGoogle,
		streamSimple: streamSimpleGoogle,
	});
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
