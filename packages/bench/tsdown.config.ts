import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/index.ts", "src/cli.ts"],
  format: ["esm"],
  platform: "node",
  dts: true,
  sourcemap: false,
  clean: true,
  outExtensions: () => ({ js: ".js", dts: ".d.ts" }),
});
