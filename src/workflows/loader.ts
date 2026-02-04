import fs from "node:fs/promises";
import path from "node:path";
import { getConfig } from "../config";
import { WorkflowConfig } from "./types";

export async function loadWorkflows(): Promise<WorkflowConfig[]> {
  const { workflowsDir } = getConfig();
  const abs = path.isAbsolute(workflowsDir) ? workflowsDir : path.join(process.cwd(), workflowsDir);
  const entries = await fs.readdir(abs, { withFileTypes: true });

  const configs: WorkflowConfig[] = [];
  for (const ent of entries) {
    if (!ent.isFile()) continue;
    if (!ent.name.endsWith(".json")) continue;
    const full = path.join(abs, ent.name);
    const raw = await fs.readFile(full, "utf8");
    const parsed = JSON.parse(raw) as WorkflowConfig;
    configs.push(parsed);
  }

  configs.sort((a, b) => a.id.localeCompare(b.id));
  return configs;
}
