import { defineConfig } from "tsdown";

// Bundle to a single self-contained ESM file so `node dist/judge.js` runs inside
// the Kernel verifier VM with no dependency install. pi-ai is bundled in
// (noExternal); it lazy-loads providers via dynamic import(), so
// inlineDynamicImports folds those chunks back into the one judge.js the
// adapter copies next to test.sh.
export default defineConfig({
  entry: ["src/judge.ts"],
  format: ["esm"],
  platform: "node",
  dts: false,
  sourcemap: false,
  clean: true,
  noExternal: [/.*/],
  outputOptions: { inlineDynamicImports: true },
  outExtensions: () => ({ js: ".js" }),
});
