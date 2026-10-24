import { existsSync, readFileSync } from "node:fs";

export function loadEnvironmentFiles(fileNames = [".env.local", ".env"]): void {
  for (const fileName of fileNames) {
    if (!existsSync(fileName)) continue;
    for (const rawLine of readFileSync(fileName, "utf8").split("\n")) {
      const trimmedLine = rawLine.trim();
      if (!trimmedLine || trimmedLine.startsWith("#") || !trimmedLine.includes("=")) continue;
      const separatorIndex = trimmedLine.indexOf("=");
      const variableName = trimmedLine.slice(0, separatorIndex).trim();
      const variableValue = trimmedLine.slice(separatorIndex + 1).replace(/\s+#.*$/, "").trim().replace(/^["']|["']$/g, "");
      if (process.env[variableName] === undefined) process.env[variableName] = variableValue; // real env vars (Codespaces secrets) win
    }
  }
}
