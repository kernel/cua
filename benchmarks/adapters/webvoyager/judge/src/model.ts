import {
  type Api,
  completeSimple,
  getEnvApiKey,
  getModel,
  type KnownProvider,
  type Model,
} from "@earendil-works/pi-ai";
import type { JudgeContent, JudgeModel } from "./types.ts";

/**
 * A {@link JudgeModel} backed by pi-ai's `completeSimple`. pi-ai handles provider
 * routing, env-var API keys, o-series quirks (omitting `temperature`, using
 * `max_completion_tokens`), vision, and retries — so the judge needs no
 * hand-rolled provider client. Bundled into the verifier (no `npm install` at
 * grade time); the Kernel VM ships `node` + global `fetch`.
 *
 * `JUDGE_MODEL` is a `provider:name` ref. The provider defaults to `anthropic`
 * when no prefix is given, matching the upstream WebVoyager judge (and this
 * adapter's `claude-sonnet-4-5` default), so a bare model name stays valid while
 * `openai:o4-mini` etc. remains configurable.
 */

// Upstream auto_eval.py caps the judge at max_tokens=1000.
const MAX_TOKENS = 1000;

export function parseModelRef(ref: string): { provider: KnownProvider; name: string } {
  const idx = ref.indexOf(":");
  if (idx === -1) return { provider: "anthropic", name: ref };
  return { provider: ref.slice(0, idx) as KnownProvider, name: ref.slice(idx + 1) };
}

export function judgeModel(ref: string): JudgeModel {
  const { provider, name } = parseModelRef(ref);
  // getModel is typed for literal provider/model ids; JUDGE_MODEL is a runtime
  // string, so widen the way pi-ai's own consumers do.
  const model = getModel(provider as never, name as never) as Model<Api>;
  const apiKey = getEnvApiKey(provider);
  return {
    async complete(systemPrompt, content) {
      const res = await completeSimple(
        model,
        { systemPrompt, messages: [{ role: "user", content, timestamp: Date.now() }] },
        { apiKey, temperature: 0, maxTokens: MAX_TOKENS },
      );
      return res.content.flatMap((c) => (c.type === "text" ? [c.text] : [])).join("");
    },
  };
}
