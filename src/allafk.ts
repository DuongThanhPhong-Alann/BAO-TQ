import cron from "node-cron";
import { logger } from "./logger";
import { WorkflowConfig } from "./workflows/types";
import { runWorkflowById } from "./workflows/runner";

const DEFAULT_TIME = "21:00";
const DEFAULT_TIMEZONE = "Asia/Ho_Chi_Minh";

const ALLAFK_WORKFLOW_IDS = [
  "gamek-gk",
  "afk-lichgame",
  "afk-h5",
  "afk-mobile",
  "afk-topgame",
  "afk-tin-game"
] as const;

function parseHHMM(input: string): { hour: number; minute: number } {
  const match = /^(\d{1,2}):(\d{2})$/.exec(input.trim());
  if (!match) throw new Error(`Invalid time "${input}" (expected HH:MM)`);
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) throw new Error(`Invalid hour in "${input}"`);
  if (!Number.isInteger(minute) || minute < 0 || minute > 59)
    throw new Error(`Invalid minute in "${input}"`);
  return { hour, minute };
}

function hhmmToCronExpr(hhmm: string): string {
  const { hour, minute } = parseHHMM(hhmm);
  return `${minute} ${hour} * * *`;
}

export async function runAllafk(workflows: WorkflowConfig[]): Promise<void> {
  for (const id of ALLAFK_WORKFLOW_IDS) {
    await runWorkflowById(workflows, id);
  }
}

export async function scheduleAllafk(
  workflows: WorkflowConfig[],
  opts?: { time?: string; timezone?: string; runOnStart?: boolean; block?: boolean }
): Promise<void> {
  const time = opts?.time || DEFAULT_TIME;
  const timezone = opts?.timezone || DEFAULT_TIMEZONE;
  const expr = hhmmToCronExpr(time);

  let isRunning = false;

  const runOnce = async () => {
    if (isRunning) {
      logger.warn({ schedule: "allafk" }, "Skipped run because previous run is still in progress");
      return;
    }

    isRunning = true;
    const startedAt = new Date().toISOString();
    logger.info(
      { schedule: "allafk", startedAt, workflows: ALLAFK_WORKFLOW_IDS },
      "Allafk run started"
    );

    try {
      await runAllafk(workflows);
      logger.info({ schedule: "allafk", startedAt }, "Allafk run finished");
    } catch (err) {
      logger.error({ err, schedule: "allafk", startedAt }, "Allafk run failed");
    } finally {
      isRunning = false;
    }
  };

  cron.schedule(expr, runOnce, { timezone });
  logger.info({ schedule: "allafk", cron: expr, timezone }, "Allafk scheduler running");

  if (opts?.runOnStart) {
    await runOnce();
  }

  if (opts?.block !== false) {
    await new Promise(() => {});
  }
}
