import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  use: { baseURL: "http://localhost:5173", headless: true },
  webServer: [
    {
      command: "node ../server/src/index.js",
      port: 8787,
      reuseExistingServer: true,
      stdout: "ignore",
    },
    {
      command: "npm run dev",
      port: 5173,
      reuseExistingServer: true,
      stdout: "ignore",
    },
  ],
});
