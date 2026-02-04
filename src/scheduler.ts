import cron from "node-cron";
import { getConfig } from "./config";
import { logger } from "./logger";
import { WorkflowConfig } from "./workflows/types";
import { runWorkflow } from "./workflows/runner";

export async function scheduleAllWorkflows(workflows: WorkflowConfig[]): Promise<void> {
  const config = getConfig();
  const enabled = workflows.filter((w) => w.enabled && w.cron);

  if (enabled.length === 0) {
    logger.warn("No enabled workflows with cron found.");
    return;
  }

  for (const wf of enabled) {
    const expr = wf.cron!;
    const timezone = wf.scheduleTimezone || "Asia/Ho_Chi_Minh";

    cron.schedule(
      expr,
      async () => {
        try {
          await runWorkflow(wf);
        } catch (err) {
          logger.error({ err, workflow: wf.id }, "Scheduled run failed");
        }
      },
      { timezone }
    );

    logger.info({ workflow: wf.id, cron: expr, timezone }, "Scheduled workflow");
  }

  if (config.runOnStart) {
    for (const wf of enabled) {
      try {
        await runWorkflow(wf);
      } catch (err) {
        logger.error({ err, workflow: wf.id }, "Run-on-start failed");
      }
    }
  }

  logger.info("Scheduler running");
  await new Promise(() => {});
}
