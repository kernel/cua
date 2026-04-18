---
name: cua-cli
description: Drive a Kernel cloud browser from the shell using the `cua` CLI. Use this skill when you need to open URLs, click elements, type into fields, take screenshots, or chain multi-step browser tasks across shell calls. Supports named sessions for stateful workflows.
---

# cua-cli

`cua` is a single-binary CLI that drives a real headless Chrome session
running in the Kernel cloud. It's designed for agentic use: each
subcommand returns a one-line result on stdout and a deterministic exit
code, so you can chain calls together and parse the output.

## One-shot subcommands

Each call below provisions a fresh Kernel browser by default, runs the
action, and tears the browser down. Use `-s <name>` (see "Named
sessions" below) to keep state across calls.

| Subcommand | What it does | Stdout | Exit code |
| --- | --- | --- | --- |
| `cua open <url>` | Navigate to a URL via the address bar. | `ok` | 0 ok, 2 error |
| `cua click "<description>"` | Find the element matching `<description>` and click it. | `ok clicked (x, y)` or `not_found <reason>` | 0 ok, 1 not_found, 2 error |
| `cua type "<target>" "<text>"` | Focus the field matching `<target>` and type text. | `ok typed` or `not_found <reason>` | 0 ok, 1 not_found, 2 error |
| `cua press <key> [<key>...]` | Send a key combo (e.g. `cua press ctrl l`, `cua press Return`). | `ok pressed` | 0 ok, 2 error |
| `cua url` | Read and print the current URL. | the URL | 0 ok, 2 error |
| `cua observe ["question"]` | Describe the page; optionally answer a question. | the description | 0 ok, 2 error |
| `cua screenshot --out <file\|->` | Save a PNG. `--out -` writes the bytes to stdout. | the path or `(stdout)` | 0 ok, 2 error |
| `cua do "<instruction>"` | Open-ended; let the agent plan and act. Bound by `--max-steps` (default 3). | the assistant's final text | 0 ok, 2 error |

Useful flags:

- `-m <model>` — pick the LLM (default `gpt-5.4`). Other good picks:
  `claude-opus-4-7`, `gemini-3-flash-preview`.
- `--max-steps <n>` — bound the agent loop on `cua do` (default 3).
- `--profile <id-or-name>` — load a Kernel browser profile (cookies /
  storage). Persists changes back unless `--profile-no-save-changes`.
- `-v` — verbose progress on stderr (provisioning, tool calls, transcript path).

## Named sessions for multi-call workflows

Without `-s`, each subcommand provisions a brand-new browser. To keep
state (cookies, scroll position, current URL) across calls, allocate a
named session first:

```bash
cua session start login                   # creates a Kernel browser, prints `name=login`
cua -s login open https://github.com/login
cua -s login type "email field" "$EMAIL"
cua -s login type "password field" "$PASSWORD"
cua -s login click "Sign in"
cua -s login url                          # prints the post-login URL
cua session stop login                    # tears down the Kernel browser
```

Inspect:

```bash
cua session list                          # tab-formatted: NAME, KERNEL_ID, AGE, LIVE_URL
cua session show login                    # full JSON metadata
```

Liveness: Kernel browsers can time out from inactivity even between
your calls. If `cua -s <name> ...` returns `error session "<name>" is no
longer alive on Kernel ...`, run `cua session stop <name> && cua session
start <name>` to provision a fresh one.

## Session transcripts

Every `cua --print` and `cua -s <name>` invocation appends to a JSONL
transcript at:

```
~/.local/share/cua/sessions/<cwd-hash>/<id>.jsonl
```

(Or `$XDG_DATA_HOME/cua/sessions/...` when set.) For named sessions, the
exact path is in `cua session show <name>` under `transcript_path`.

Each line is a JSON object with one of these `role` values:
`user`, `assistant`, `toolResult`. There's also a custom `cua-browser`
entry written once per session with `kernel_session_id` / `live_url` /
`profile_id`.

For more structured event analysis use `cua --print -o jsonl "..."`,
which streams one event per line on stdout (different schema — see the
cua-cli README).

## Free-form mode

Two ways to give the agent free rein:

```bash
cua --print "open hn and tell me the top story"            # one-shot, streams text to stdout
cua --print -o jsonl "..."                                 # one-shot, streams JSONL events
cua "..."                                                  # interactive TUI (requires a real terminal)
```

`--print` exits when the agent finishes; the interactive TUI keeps
running until you Ctrl+C.

## Don't forget

- Subcommands that need a target (`click`, `type`) match SEMANTICALLY,
  not by selector. Use natural-language descriptions of what the user
  would see on screen.
- Browser viewport defaults to 1920x1080.
- Keyboard navigation (`Page_Down`, `Home`, arrow keys via `cua press`)
  is more reliable than mouse-wheel scrolling.
- For multi-step state, you almost always want `-s <name>`. Without it,
  the second subcommand can't see anything the first one did.
