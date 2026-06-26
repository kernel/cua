# `@onkernel/cua-bench`

Extensible web-agent benchmark runner. It runs benchmarks against the
[`@onkernel/cua-agent`](https://www.npmjs.com/package/@onkernel/cua-agent) loop
driving Kernel cloud browsers, collects each run's trajectory, and grades it
with a configurable LLM judge.

The first (and currently only) fully-built benchmark is **Online-Mind2Web**,
graded by a ported **WebJudge**.

## Installation

```bash
npm install @onkernel/cua-bench @onkernel/cua-agent @onkernel/cua-ai @onkernel/sdk
```

## CLI

```bash
cua-bench run online-mind2web \
  --model anthropic:claude-opus-4-7 \
  --judge-model anthropic:claude-opus-4-7 \
  --limit 5 \
  --concurrency 1 \
  --out ./bench-results/online-mind2web
```

| Flag | Default | Description |
| --- | --- | --- |
| `--model` | `anthropic:claude-opus-4-7` | Provider-qualified agent model ref. |
| `--judge-model` | `--model` | Provider-qualified judge model ref (multimodal). |
| `--limit` | all tasks | Run only the first N tasks. |
| `--concurrency` | `1` | Tasks run in parallel. Live sites + cost — keep this low. |
| `--score-threshold` | `3` | WebJudge keeps screenshots scoring at or above this (1–5). |
| `--out` | `./bench-results/<benchmark>` | Output directory. |
| `--cache-dir` | `~/.cache/cua-bench/online-mind2web` | Dataset cache location. |

`KERNEL_API_KEY` and the provider key for both the agent and judge models must
be set in the environment (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`,
`GOOGLE_API_KEY`/`GEMINI_API_KEY`, ...).

### Output

Per-task results are appended as JSONL to `<out>/<benchmark>.results.jsonl`, and
an aggregate `<out>/summary.json` records the success rate.

## Library

```ts
import { runBenchmark } from "@onkernel/cua-bench";

const summary = await runBenchmark({
  benchmark: "online-mind2web",
  model: "anthropic:claude-opus-4-7",
  judgeModel: "anthropic:claude-opus-4-7",
  limit: 5,
  outDir: "./bench-results/online-mind2web",
});
console.log(summary.successRate);
```

## Adding a benchmark

A benchmark implements the `Benchmark` interface (`src/types.ts`):

```ts
export interface Benchmark {
  id: string;
  description: string;
  loadTasks(opts: LoadTasksOptions): Promise<BenchTask[]>;
  buildInstruction(task: BenchTask): string;
  grade(args: GradeArgs): Promise<GradeResult>;
}
```

Add a module under `src/benchmarks/<name>/`, then register it in
`src/registry.ts`. The runner, trajectory capture, output, and CLI are shared.
Planned benchmarks (not yet implemented): `webvoyager`, `webarena`, `gaia` (see
`PLANNED_BENCHMARKS`).

## Online-Mind2Web

- 300 live web tasks from [`osunlp/Online-Mind2Web`](https://huggingface.co/datasets/osunlp/Online-Mind2Web).
- The dataset is **gated**. Accept the terms on the dataset page and set
  `HF_TOKEN` (or `HUGGINGFACE_TOKEN` / `HUGGING_FACE_HUB_TOKEN`). The loader
  fetches the task file at runtime and caches it under `--cache-dir`.

### WebJudge

The grader is an LLM-as-judge ported from the upstream repo: it identifies the
task's key points, scores each trajectory screenshot, keeps the relevant ones,
and asks for a final success/failure verdict.

The judge model is configurable (`--judge-model`) and not tied to any provider.
**Reproducing the paper's human-agreement numbers requires the upstream o4-mini
backbone or the released WebJudge-7B reward model.** This package targets a
working, configurable pipeline — not a parity claim.

## Live smoke

Live runs **cost money and hit live websites**. There is no automated live test;
the unit suite mocks the Kernel harness and the judge LLM and runs offline. To
try a single live task, use the CLI with `--limit 1`.
