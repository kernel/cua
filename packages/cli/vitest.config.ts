import { defineConfig } from "vitest/config";

// `server.host` pins vitest's internal dev server to a literal IP. Without
// this, `localhost` is resolved by Node's DNS — in sandboxed CI environments
// that don't have `localhost` in /etc/hosts the bootstrap fails with
// `ENOTFOUND localhost`. The setting is a no-op when running tests directly
// but keeps the dev-server bootstrap from doing a DNS lookup.
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
