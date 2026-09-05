import { defineConfig } from "vitest/config";

const nodeSqliteExternal = {
  name: "node-sqlite-external",
  enforce: "pre" as const,
  resolveId(source: string) {
    if (source === "node:sqlite" || source === "sqlite") {
      return { id: "node:sqlite", external: true };
    }
    return null;
  },
};

export default defineConfig({
  plugins: [nodeSqliteExternal],
  test: {
    environment: "node",
    fileParallelism: false,
    globals: false,
  },
  ssr: {
    external: ["node:sqlite"],
  },
});
