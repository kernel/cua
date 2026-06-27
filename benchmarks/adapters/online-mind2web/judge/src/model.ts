import type { JudgeContent, JudgeModel } from "./types.ts";

/**
 * {@link JudgeModel} implementations backed by raw `fetch` calls to a provider's
 * chat API. Self-contained so the bundled judge runs inside the Kernel browser
 * VM with no `npm install` at verify time (the VM ships `node` and global
 * `fetch` but not the cua SDKs or any provider SDK).
 *
 * The judge model is given as a `provider:name` ref. `openai` is the default
 * provider — canonical WebJudge runs on an OpenAI o-series backbone (o4-mini),
 * which is what the published leaderboard numbers are calibrated to. `anthropic`
 * stays wired as a configurable, non-canonical alternative.
 */
const OPENAI_URL = "https://api.openai.com/v1/chat/completions";
const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";

// Upstream caps each stage at 512 (max_new_tokens). We keep 1024 of headroom so
// the verbose judge's per-image reasoning isn't truncated before the
// `Score`/`Status:` line the parsers key on.
const MAX_OUTPUT_TOKENS = 1024;

interface AnthropicBlock {
  type: string;
  text?: string;
}

export function parseModelRef(ref: string): { provider: string; name: string } {
  const idx = ref.indexOf(":");
  if (idx === -1) return { provider: "openai", name: ref };
  return { provider: ref.slice(0, idx), name: ref.slice(idx + 1) };
}

/** Provider dispatch for `JUDGE_MODEL` refs. Defaults to OpenAI when no prefix. */
export function judgeModel(ref: string): JudgeModel {
  const { provider } = parseModelRef(ref);
  switch (provider) {
    case "openai":
      return openaiJudgeModel(ref);
    case "anthropic":
      return anthropicJudgeModel(ref);
    default:
      throw new Error(
        `unsupported judge provider "${provider}" (openai or anthropic); got "${ref}"`,
      );
  }
}

/** o-series reasoning models (o4-mini, o3, …) reject `temperature` and need
 * `max_completion_tokens` instead of `max_tokens`. */
function isOSeries(name: string): boolean {
  return /^o\d/.test(name);
}

function toOpenAIContent(content: JudgeContent): unknown[] {
  return content.map((part) =>
    part.type === "text"
      ? { type: "text", text: part.text }
      : {
          type: "image_url",
          // WebJudge sends `detail: high` so the judge scores the full screenshot.
          image_url: {
            url: `data:${part.mimeType};base64,${part.data}`,
            detail: "high",
          },
        },
  );
}

/** OpenAI Chat Completions judge. Resolves the API key from `OPENAI_API_KEY`. */
export function openaiJudgeModel(ref: string): JudgeModel {
  const { provider, name } = parseModelRef(ref);
  if (provider !== "openai") {
    throw new Error(`openaiJudgeModel got a non-openai ref "${ref}"`);
  }
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is required for the WebJudge model");
  }
  const oSeries = isOSeries(name);
  const headers = {
    "content-type": "application/json",
    authorization: `Bearer ${apiKey}`,
  };

  return {
    async complete(systemPrompt, content) {
      const body: Record<string, unknown> = {
        model: name,
        // o-series uses max_completion_tokens; older chat models use max_tokens.
        [oSeries ? "max_completion_tokens" : "max_tokens"]: MAX_OUTPUT_TOKENS,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: toOpenAIContent(content) },
        ],
      };
      // WebJudge wants deterministic scoring (temperature 0), but o-series
      // reasoning models reject the field outright — omit it for o-series.
      if (!oSeries) body.temperature = 0;
      const res = await fetch(OPENAI_URL, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const errBody = await res.text();
        throw new Error(`OpenAI API error ${res.status}: ${errBody}`);
      }
      const data = (await res.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      return data.choices?.[0]?.message?.content ?? "";
    },
  };
}

function toAnthropicContent(content: JudgeContent): unknown[] {
  return content.map((part) =>
    part.type === "text"
      ? { type: "text", text: part.text }
      : {
          type: "image",
          source: { type: "base64", media_type: part.mimeType, data: part.data },
        },
  );
}

/** Anthropic Messages judge. Resolves the API key from `ANTHROPIC_API_KEY`. */
export function anthropicJudgeModel(ref: string): JudgeModel {
  const { provider, name } = parseModelRef(ref);
  if (provider !== "anthropic") {
    throw new Error(`anthropicJudgeModel got a non-anthropic ref "${ref}"`);
  }
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY is required for the WebJudge model");
  }
  const headers = {
    "content-type": "application/json",
    "x-api-key": apiKey,
    "anthropic-version": ANTHROPIC_VERSION,
  };

  async function callOnce(
    systemPrompt: string,
    content: JudgeContent,
    withTemperature: boolean,
  ): Promise<Response> {
    const body: Record<string, unknown> = {
      model: name,
      max_tokens: MAX_OUTPUT_TOKENS,
      system: systemPrompt,
      messages: [{ role: "user", content: toAnthropicContent(content) }],
    };
    // WebJudge wants deterministic scoring, but newer models (e.g. opus-4-8)
    // reject `temperature` outright; on that 400 we retry without it.
    if (withTemperature) body.temperature = 0;
    return fetch(ANTHROPIC_URL, { method: "POST", headers, body: JSON.stringify(body) });
  }

  return {
    async complete(systemPrompt, content) {
      let res = await callOnce(systemPrompt, content, true);
      if (res.status === 400) {
        const body = await res.text();
        if (body.includes("temperature")) {
          res = await callOnce(systemPrompt, content, false);
        } else {
          throw new Error(`Anthropic API error 400: ${body}`);
        }
      }
      if (!res.ok) {
        const body = await res.text();
        throw new Error(`Anthropic API error ${res.status}: ${body}`);
      }
      const data = (await res.json()) as { content?: AnthropicBlock[] };
      return (data.content ?? [])
        .flatMap((b) => (b.type === "text" && b.text ? [b.text] : []))
        .join("");
    },
  };
}
