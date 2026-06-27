import { defineConfig } from "tsdown";

// Bundle to a single self-contained ESM file so `node dist/judge.js` runs inside
// the Kernel VM with no dependency install. No externals: the judge only uses
// node builtins and global fetch.
export default defineConfig({
  entry: ["src/judge.ts"],
  format: ["esm"],
  platform: "node",
  dts: false,
  sourcemap: false,
  clean: true,
  noExternal: [/.*/],
  outExtensions: () => ({ js: ".js" }),
});
