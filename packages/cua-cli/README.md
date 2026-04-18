# `@onkernel/cua-cli`

The CLI / TUI binary for the [`cua`](../../README.md) monorepo. Wires
[`@onkernel/cua-translator`](../cua-translator),
[`@onkernel/cua-openai`](../cua-openai),
[`@onkernel/cua-anthropic`](../cua-anthropic), and
[`@onkernel/cua-gemini`](../cua-gemini)
into a [`pi-agent-core`](https://www.npmjs.com/package/@mariozechner/pi-agent-core)
agent with a [`pi-tui`](https://www.npmjs.com/package/@mariozechner/pi-tui)
interactive front-end.

## Install (from the monorepo)

```bash
npm install
npm run build
ln -s "$(pwd)/bin/cua" ~/.local/bin/cua    # put `cua` on your $PATH
cua --help
```

## Usage

```bash
# Interactive TUI:
cua

# Single-shot prompt:
cua --print "open https://example.com and tell me the heading"

# Constrained one-shot subcommands (deterministic exit codes):
cua open https://example.com
cua click "Sign in button"
cua type "email field" "alice@example.com"
cua press ctrl l                              # Ctrl+L (focus address bar)
cua url
cua observe "what page is loaded?"
cua screenshot --out shot.png
cua do "buy a pair of socks on amazon" --max-steps 20

# Pick a provider explicitly (otherwise inferred from model id):
cua --print --model claude-opus-4-7                          "..."  # → anthropic
cua --print --model gemini-3-flash-preview                   "..."  # → gemini
cua --print --provider openai                                "..."

# Named sessions (browser stays alive across calls):
cua session start login                       # provisions Kernel browser
cua -s login open https://github.com/login
cua -s login type "email field" "$EMAIL"
cua -s login click "Sign in"
cua session stop login

cua session list                              # NAME / KERNEL_ID / AGE / LIVE_URL
cua session show login                        # full JSON metadata

# Resume a prior session transcript into a fresh browser:
cua --continue
cua --resume                                  # picker
cua --session abc12345                        # by id prefix
```

## Provider routing

| `--model` prefix          | Provider    | API key env / config field                                    |
| ------------------------- | ----------- | ------------------------------------------------------------- |
| `gpt-*`                   | `openai`    | `OPENAI_API_KEY` / `openai_api_key`                           |
| `claude-*`, `anthropic.*` | `anthropic` | `ANTHROPIC_API_KEY` / `anthropic_api_key`                     |
| `gemini-*`                | `gemini`    | `GOOGLE_API_KEY` (or `GEMINI_API_KEY`) / `google_api_key`     |

Override the inferred provider with `--provider openai|anthropic|gemini`.

Recommended Gemini model id (from
[Google's Computer Use docs](https://ai.google.dev/gemini-api/docs/computer-use)):

- `gemini-3-flash-preview` — Gemini 3 Flash with built-in computer use.

## Configuration

```bash
cua config init   # interactive, writes ~/.config/cua/config.toml
cua config show   # masked dump of the resolved config
```

Example `~/.config/cua/config.toml`:

```toml
default_profile = "default"

[profiles.default]
openai_api_key      = "sk-..."
anthropic_api_key   = "sk-ant-..."
google_api_key      = "..."
kernel_api_key      = "kk_..."

[profiles.default.openai.default]
reasoning_effort  = "low"
tool_preamble     = true
compact_threshold = 100000

[profiles.default.anthropic.default]
reasoning_effort  = "low"
tool_preamble     = true

[profiles.default.gemini.default]
reasoning_effort  = "low"
tool_preamble     = true

[[profiles.default.openai.models]]
name              = "gpt-5.4"
reasoning_effort  = "medium"
```

Per-model blocks resolve in order: exact match → longest prefix match
→ default block.

Env var overrides:

| Env                  | Maps to                                        |
| -------------------- | ---------------------------------------------- |
| `OPENAI_API_KEY`     | `openai_api_key`                               |
| `OPENAI_BASE_URL`    | `openai_base_url`                              |
| `ANTHROPIC_API_KEY`  | `anthropic_api_key`                            |
| `ANTHROPIC_BASE_URL` | `anthropic_base_url`                           |
| `GOOGLE_API_KEY`     | `google_api_key`                               |
| `GEMINI_API_KEY`     | alias of `GOOGLE_API_KEY`                      |
| `GOOGLE_BASE_URL`    | `google_base_url`                              |
| `KERNEL_API_KEY`     | `kernel_api_key`                               |
| `KERNEL_BASE_URL`    | `kernel_base_url`                              |
| `XDG_CONFIG_HOME`    | config dir base (defaults to `~/.config`)      |
| `XDG_DATA_HOME`      | sessions dir base (defaults to `~/.local/share`) |
| `CUA_IMAGE_PROTOCOL` | force inline image protocol (`kitty`/`iterm2`/`none`/`auto`) |

## Output formats

`--print` defaults to streaming text. Pass `-o jsonl` for one
structured event per line (good for scripting):

```bash
cua --print -o jsonl "open https://example.com" \
  | jq -c 'select(.type=="tool_call" or .type=="assistant_text_done")'
```

Add `--jsonl-include-deltas` for assistant-token deltas and
`--jsonl-include-images` for base64 screenshots in `tool_result` events.

## Sessions and transcripts

`--print`, the interactive TUI, and any `-s <name>` invocation persist
a JSONL transcript to
`$XDG_DATA_HOME/cua/sessions/<cwd-hash>/<id>.jsonl` by default
(typically `~/.local/share/cua/sessions/...`). Pass `--no-session` to
keep a run in-memory only, or `--session-dir <path>` to override the
location.

For named sessions, the exact transcript path is in
`cua session show <name>` under `transcript_path`. See the
[Session transcripts section in the top-level README](../../README.md#session-transcripts)
for the JSONL schema and `jq` analysis examples.

## Skills

`cua` follows the cross-agent
[`~/.agents/skills/`](https://agentskills.io) standard. Discovery
defaults:

- `~/.agents/skills/` (user-global)
- `<cwd>/.agents/skills/` (project-local)

Plus any explicit `--skill <path>` flags. Disable with `--no-skills`
(`-ns`).

Each skill's `name`, `description`, and file `location` are added to
the system prompt; the model uses the `read` tool to load a skill's
full body when its description matches the task. Use `/skill:<name>`
in a prompt to force-load a skill body inline.

## Image protocol

Force the inline-screenshot protocol with `--image-protocol` or
`CUA_IMAGE_PROTOCOL`:

- `kitty`  — Kitty graphics protocol (also covers Ghostty / WezTerm).
- `iterm2` — iTerm2 inline images.
- `none`   — disable inline images; show a compact text card instead.
- `auto`   — auto-detect based on `TERM_PROGRAM` / `TMUX` / etc. (default).

The TUI prints the resolved capability as the second header line so
you can see at a glance whether inline images will render.

## License

MIT.
