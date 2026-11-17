// Demo mode: the real UI with sample data and no backend. `npm run demo`.
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const mock = fileURLToPath(new URL("./scripts/demo/convex-react.tsx", import.meta.url));

export default defineConfig({
  plugins: [react(), tailwindcss()],
  define: { "import.meta.env.VITE_CONVEX_URL": JSON.stringify("https://demo.invalid") },
  resolve: {
    alias: [
      { find: /^convex\/react$/, replacement: mock },
      { find: /^@convex-dev\/auth\/react$/, replacement: mock },
      { find: /^@convex-dev\/auth\/methods\/username-password\/react$/, replacement: mock },
    ],
  },
  server: { port: 5174 },
});
