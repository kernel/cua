import { createRequire } from "node:module";
import { defineConfig } from "tsdown";

const require = createRequire(import.meta.url);
const { version } = require("./package.json") as { version: string };

export default defineConfig({
  entry: ["src/cli.ts"],
  format: ["esm"],
  platform: "node",
  dts: false,
  sourcemap: false,
  clean: true,
  outExtensions: () => ({ js: ".js" }),
  define: {
    __CUA_VERSION__: JSON.stringify(version),
  },
});
