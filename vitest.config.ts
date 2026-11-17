import { readFileSync } from "node:fs";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    {
      // The password hasher ships as WebAssembly. Convex's bundler imports
      // .wasm files as compiled modules, so tests do the same.
      name: "wasm-as-module",
      enforce: "pre",
      load(id) {
        if (!id.endsWith(".wasm")) return null;
        const b64 = readFileSync(id).toString("base64");
        return `const bytes = Uint8Array.from(atob("${b64}"), (c) => c.charCodeAt(0));
export default new WebAssembly.Module(bytes);`;
      },
    },
  ],
  test: {
    environment: "edge-runtime",
    include: ["convex/**/*.test.ts"],
    server: { deps: { inline: ["convex-test", "password-hash-wasm", "@convex-dev/auth"] } },
  },
});
