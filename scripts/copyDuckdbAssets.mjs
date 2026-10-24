import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const sourceDirectory = join("node_modules", "@duckdb", "duckdb-wasm", "dist"); // installed package dist folder
const targetDirectory = join("public", "duckdb"); // served same-origin so the browser never needs a third-party CDN
const assetNames = ["duckdb-mvp.wasm", "duckdb-eh.wasm", "duckdb-browser-mvp.worker.js", "duckdb-browser-eh.worker.js"];

if (!existsSync(sourceDirectory)) {
  console.log("duckdb-wasm not installed yet, skipping asset copy");
} else {
  mkdirSync(targetDirectory, { recursive: true });
  for (const assetName of assetNames) {
    copyFileSync(join(sourceDirectory, assetName), join(targetDirectory, assetName));
  }
  console.log(`copied ${assetNames.length} duckdb-wasm assets to ${targetDirectory}`);
}
