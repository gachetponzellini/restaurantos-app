import { defineConfig } from "vitest/config";

import base from "./vitest.config";

/**
 * Escenarios que se corren a mano (no entran en `pnpm test`): preparan datos en
 * la base LOCAL para probar a mano. Ver `pnpm escenario:demo`.
 */
export default defineConfig({
  ...base,
  test: {
    ...base.test,
    include: ["src/**/*.escenario.ts"],
    environment: "node",
    testTimeout: 600_000,
    hookTimeout: 600_000,
    fileParallelism: false,
  },
});
