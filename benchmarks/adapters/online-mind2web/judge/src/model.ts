import type { JudgeContent, JudgeModel } from "./types.ts";

/**
 * A {@link JudgeModel} backed by the Anthropic Messages API over `fetch`.
 *
 * Self-contained so the bundled judge runs inside the Kernel browser VM with no
 * `npm install` at verify time (the VM ships `node` and global `fetch` but not
 * the cua SDKs). The judge model is given as a `provider:name` ref; only the
 * `anthropic` provider is wired because it is the configured judge backbone.
 */
const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";

interface AnthropicBlock {
  type: string;
  text?: string;
}

export function parseModelRef(ref: string): { provider: string; name: string } {
  const idx = ref.indexOf(":");
  if (idx === -1) return { provider: "anthropic", name: ref };
  return { provider: ref.slice(0, idx), name: ref.slice(idx + 1) };
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

/** Anthropic-backed judge. Resolves the API key from `ANTHROPIC_API_KEY`. */
export function anthropicJudgeModel(ref: string): JudgeModel {
  const { provider, name } = parseModelRef(ref);
  if (provider !== "anthropic") {
    throw new Error(
      `unsupported judge provider "${provider}" (only anthropic is wired); got "${ref}"`,
    );
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
      // Upstream caps each stage at 512 (max_new_tokens). We keep 1024 of headroom
      // so the verbose opus judge's per-image reasoning isn't truncated before the
      // `Score`/`Status:` line the parsers key on.
      max_tokens: 1024,
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
