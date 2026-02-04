import path from "node:path";

export type AppConfig = {
  workflowsDir: string;
  logLevel: string;
  runOnStart: boolean;
  googleServiceAccountJson?: string;
  googleApplicationCredentials?: string;
};

export function getConfig(): AppConfig {
  const workflowsDir =
    process.env.WORKFLOWS_DIR?.trim() || path.join("config", "workflows");
  const logLevel = process.env.LOG_LEVEL?.trim() || "info";
  const runOnStart = (process.env.RUN_ON_START || "false").toLowerCase() === "true";
  const googleServiceAccountJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON?.trim();
  const googleApplicationCredentials = process.env.GOOGLE_APPLICATION_CREDENTIALS?.trim();

  return {
    workflowsDir,
    logLevel,
    runOnStart,
    googleServiceAccountJson: googleServiceAccountJson || undefined,
    googleApplicationCredentials: googleApplicationCredentials || undefined
  };
}
