import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";
import {
  configSchema,
  defaultConfig,
  type TokenFaxxConfig,
} from "@tokenfaxx/core";
export async function loadConfig(repository: string): Promise<TokenFaxxConfig> {
  const filename = path.join(repository, "tokenfaxx.config.ts");
  if (!fs.existsSync(filename)) return defaultConfig();
  try {
    // A globally installed CLI must resolve defineConfig from its own dependency
    // graph, not require every tracked repository to install @tokenfaxx/core.
    const jiti = createJiti(import.meta.url, {
      interopDefault: true,
      alias: {
        "@tokenfaxx/core": fileURLToPath(
          import.meta.resolve("@tokenfaxx/core"),
        ),
      },
    });
    const loaded = await jiti.import(filename, { default: true });
    return configSchema.parse(loaded);
  } catch (error) {
    throw new Error(
      `Invalid tokenfaxx.config.ts: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
export function databasePath(root: string): string {
  return path.join(root, ".tokenfaxx", "tokenfaxx.db");
}
