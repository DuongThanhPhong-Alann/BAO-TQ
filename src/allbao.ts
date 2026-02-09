import cron from "node-cron";
import { logger } from "./logger";
import { WorkflowConfig } from "./workflows/types";
import { runWorkflowById } from "./workflows/runner";

const DEFAULT_TIME = "09:21";
const DEFAULT_TIMEZONE = "Asia/Ho_Chi_Minh";

const ALLBAO_WORKFLOW_IDS = [
  "sohu",
  "gameres",
  "gnn",
  "fxbaogao",
  "dy",
  "afk-tin-game",
  "gamelook",
  "sina"
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

export async function runAllbao(workflows: WorkflowConfig[]): Promise<void> {
  for (const id of ALLBAO_WORKFLOW_IDS) {
    await runWorkflowById(workflows, id);
  }
}

export async function scheduleAllbao(
  workflows: WorkflowConfig[],
  opts?: { time?: string; timezone?: string; runOnStart?: boolean }
): Promise<void> {
  const time = opts?.time || DEFAULT_TIME;
  const timezone = opts?.timezone || DEFAULT_TIMEZONE;
  const expr = hhmmToCronExpr(time);

  let isRunning = false;

  const runOnce = async () => {
    if (isRunning) {
      logger.warn({ schedule: "allbao" }, "Skipped run because previous run is still in progress");
      return;
    }

    isRunning = true;
    const startedAt = new Date().toISOString();
    logger.info(
      { schedule: "allbao", startedAt, workflows: ALLBAO_WORKFLOW_IDS },
      "Allbao run started"
    );

    try {
      await runAllbao(workflows);
      logger.info({ schedule: "allbao", startedAt }, "Allbao run finished");
    } catch (err) {
      logger.error({ err, schedule: "allbao", startedAt }, "Allbao run failed");
    } finally {
      isRunning = false;
    }
  };

  cron.schedule(expr, runOnce, { timezone });
  logger.info({ schedule: "allbao", cron: expr, timezone }, "Allbao scheduler running");

  if (opts?.runOnStart) {
    await runOnce();
  }

  await new Promise(() => {});
}

