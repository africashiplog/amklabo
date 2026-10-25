import { defineConfig } from "vitest/config";
import path from "node:path";
import { config } from "dotenv";

// Les tests utilisent une base dédiée (amklabo_test), jamais la base principale.
const env = config().parsed ?? {};
const toTest = (url = "") => url.replace(/\/([^/?]+)(\?|$)/, "/amklabo_test$2");

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  test: {
    environment: "node",
    globalSetup: ["tests/global-setup.ts"],
    fileParallelism: false,
    testTimeout: 30000,
    env: {
      DATABASE_URL: toTest(process.env.TEST_DATABASE_URL ?? env.DATABASE_URL),
      DATABASE_OWNER_URL: toTest(process.env.TEST_DATABASE_OWNER_URL ?? env.DATABASE_OWNER_URL),
      APP_DB_PASSWORD: process.env.APP_DB_PASSWORD ?? env.APP_DB_PASSWORD ?? "",
      UPLOAD_DIR: path.resolve(__dirname, "storage/test-uploads"),
    },
  },
});
