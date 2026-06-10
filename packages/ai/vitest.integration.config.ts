import { defineConfig } from "vitest/config";

export default defineConfig({
	server: {
		host: "127.0.0.1",
	},
	test: {
		globals: true,
		environment: "node",
		testTimeout: 30000,
		include: ["test/**/*.integration.test.ts", "test/**/*.live.test.ts"],
	},
});
