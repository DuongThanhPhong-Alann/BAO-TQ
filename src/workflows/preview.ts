import { logger } from "../logger";
import { createSpinner } from "../cli/spinner";
import { fetchWorkflowItems } from "./sources";
import { getTransform } from "./transforms";
import { WorkflowConfig } from "./types";

export async function previewWorkflow(
  workflow: WorkflowConfig,
  opts: { limit?: number } = {}
): Promise<void> {
  const spinner = createSpinner();
  const transform = getTransform(workflow.transform);

  spinner.start(`Workflow ${workflow.id}: fetching items...`);
  const items = await fetchWorkflowItems(workflow, {
    limit: opts.limit,
    onProgress: (p) => {
      spinner.setProgress(p.current, p.total);
      if (p.text) spinner.update(p.text);
    }
  });
  spinner.stop(`Workflow ${workflow.id}: fetched ${items.length} items`);

  spinner.start(`Workflow ${workflow.id}: transforming...`);
  const transformed = items.map((it) => transform(it));
  const limited = typeof opts.limit === "number" ? transformed.slice(0, opts.limit) : transformed;
  spinner.stop(`Workflow ${workflow.id}: preview output ${limited.length} rows`);

  logger.info(
    { workflow: workflow.id, items: items.length, output: limited.length },
    "Preview complete"
  );

  console.log(JSON.stringify(limited, null, 2));
}

export async function previewWorkflowById(
  workflows: WorkflowConfig[],
  id: string,
  opts: { limit?: number } = {}
): Promise<void> {
  const wf = workflows.find((w) => w.id === id);
  if (!wf) throw new Error(`Workflow not found: ${id}`);
  if (!wf.enabled) throw new Error(`Workflow is disabled: ${id}`);
  await previewWorkflow(wf, opts);
}
