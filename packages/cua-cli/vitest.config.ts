import { defineConfig } from "vitest/config";

export default defineConfig({
	server: {
		host: "127.0.0.1",
	},
	test: {
		include: ["test/**/*.test.ts"],
		environment: "node",
		hookTimeout: 30_000,
		testTimeout: 30_000,
	},
});
