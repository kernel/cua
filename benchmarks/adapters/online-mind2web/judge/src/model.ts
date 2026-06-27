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
  return {
    async complete(systemPrompt, content) {
      const res = await fetch(ANTHROPIC_URL, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": ANTHROPIC_VERSION,
        },
        body: JSON.stringify({
          model: name,
          max_tokens: 1024,
          temperature: 0,
          system: systemPrompt,
          messages: [{ role: "user", content: toAnthropicContent(content) }],
        }),
      });
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
