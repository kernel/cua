import { completeSimple, getEnvApiKey, getModel } from "@earendil-works/pi-ai";
import type { Api, Model } from "@earendil-works/pi-ai";
import type { JudgeModel } from "./types.ts";

// `getModel`/`getEnvApiKey` are typed against the literal provider/model
// registry, but the judge resolves them from a runtime `provider:name` ref.
// Reach for the runtime signatures: both look up the registry and return
// undefined for an unknown provider or model.
const resolveModel = getModel as (provider: string, modelId: string) => Model<Api> | undefined;
const resolveApiKey = getEnvApiKey as (provider: string) => string | undefined;

/**
 * {@link JudgeModel} backed by `@earendil-works/pi-ai`. pi-ai owns provider
 * routing, env-key resolution (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, …), the
 * o-series reasoning quirks (no `temperature`, `max_completion_tokens`), and
 * vision encoding, so the judge no longer hand-rolls per-provider chat clients.
 * pi-ai is bundled into the verifier (tsdown, no externals) so it stays
 * self-contained inside the Kernel browser VM with no `npm install` at verify
 * time.
 *
 * The judge model is given as a `provider:name` ref. `openai` is the default
 * provider — canonical WebJudge runs on an OpenAI o-series backbone (o4-mini),
 * which is what the published leaderboard numbers are calibrated to.
 */

// Upstream caps each stage at 512 (max_new_tokens). We keep 1024 of headroom so
// the verbose judge's per-image reasoning isn't truncated before the
// `Score`/`Status:` line the parsers key on.
const MAX_OUTPUT_TOKENS = 1024;

export function parseModelRef(ref: string): { provider: string; name: string } {
  const idx = ref.indexOf(":");
  if (idx === -1) return { provider: "openai", name: ref };
  return { provider: ref.slice(0, idx), name: ref.slice(idx + 1) };
}

/** Resolve a `JUDGE_MODEL` ref to a pi-ai-backed {@link JudgeModel}. Defaults to OpenAI when no prefix. */
export function judgeModel(ref: string): JudgeModel {
  const { provider, name } = parseModelRef(ref);
  const model = resolveModel(provider, name);
  if (!model) {
    throw new Error(`unknown judge model "${ref}"`);
  }
  const apiKey = resolveApiKey(provider);
  if (!apiKey) {
    throw new Error(`no API key in the environment for judge provider "${provider}"`);
  }

  // OpenAI reasoning backbones (o4-mini, o3, …) don't accept `temperature` and
  // reject a reasoning effort of "none" (pi-ai's default when the level is
  // unset) — they require low/medium/high. "medium" is OpenAI's own o4-mini
  // default, the setting the published WebJudge agreement numbers are
  // calibrated to. Anthropic backbones reject `temperature: 0`, so we omit it
  // there and only force deterministic sampling on the remaining providers.
  const baseOptions = { apiKey, maxTokens: MAX_OUTPUT_TOKENS };
  const options =
    model.reasoning && provider === "openai"
      ? { ...baseOptions, reasoning: "medium" as const }
      : provider === "anthropic"
        ? baseOptions
        : { ...baseOptions, temperature: 0 };

  return {
    async complete(systemPrompt, content) {
      const res = await completeSimple(
        model,
        { systemPrompt, messages: [{ role: "user", content, timestamp: Date.now() }] },
        options,
      );
      // pi-ai surfaces provider errors as a message with stopReason "error"
      // rather than throwing. Raise it so the grading failure is logged to the
      // verifier and never scored as a legitimate task failure.
      if (res.stopReason === "error") {
        throw new Error(`judge model error: ${res.errorMessage ?? "unknown error"}`);
      }
      return res.content.flatMap((c) => (c.type === "text" ? [c.text] : [])).join("");
    },
  };
}
