import { defineConfig } from "eslint/config";
import nextCoreWebVitals from "eslint-config-next/core-web-vitals";

export default defineConfig([
  {
    ignores: ["cpa-runtime/dashboard-data/**"]
  },
  {
    extends: [...nextCoreWebVitals]
  }
]);
