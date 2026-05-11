import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL(".", import.meta.url))
    }
  },
  test: {
    environment: "node",
    exclude: ["**/node_modules/**", "**/.next/**", "**/.sisyphus/**", "**/cpa-runtime/**"]
  }
});
