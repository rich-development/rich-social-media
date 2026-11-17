// Demo mode: the real UI with sample data and no backend. `npm run demo`.
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const mock = fileURLToPath(new URL("./scripts/demo/convex-react.tsx", import.meta.url));

export default defineConfig({
  plugins: [react(), tailwindcss()],
  define: {
    "import.meta.env.VITE_CONVEX_URL": JSON.stringify("https://demo.invalid"),
    "import.meta.env.VITE_CLERK_PUBLISHABLE_KEY": JSON.stringify("demo"),
  },
  resolve: {
    alias: [
      { find: /^convex\/react$/, replacement: mock },
      { find: /^convex\/react-clerk$/, replacement: mock },
      { find: /^@clerk\/react$/, replacement: mock },
    ],
  },
  server: { port: 5174 },
});
