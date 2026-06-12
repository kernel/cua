import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/cli.ts"],
  format: ["esm"],
  platform: "node",
  dts: false,
  sourcemap: false,
  clean: true,
  outExtensions: () => ({ js: ".js" }),
});
