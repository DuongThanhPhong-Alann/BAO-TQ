import "dotenv/config";
import { scheduleAllbao } from "./allbao";
import { scheduleAllWorkflows } from "./scheduler";
import { loadWorkflows } from "./workflows/loader";
import { runWorkflowById } from "./workflows/runner";
import { previewWorkflowById } from "./workflows/preview";

function usage(): never {
  console.error(
    [
      "Usage:",
      "  npm run dev -- list",
      "  npm run dev -- run <workflowId>",
      "  npm run dev -- preview <workflowId> [limit]",
      "  npm run dev -- schedule",
      "  npm run dev -- schedule-allbao [HH:MM]",
      "",
      "Built (prod):",
      "  node dist/index.js list",
      "  node dist/index.js run sohu",
      "  node dist/index.js preview sohu 5",
      "  node dist/index.js schedule",
      "  node dist/index.js schedule-allbao 09:21"
    ].join("\n")
  );
  process.exit(2);
}

async function main() {
  const [command, arg1, arg2] = process.argv.slice(2);
  const workflows = await loadWorkflows();

  if (!command) usage();

  if (command === "list") {
    console.log(
      workflows
        .map((w) => `${w.id}\tenabled=${w.enabled}\tcron=${w.cron ?? "-"}`)
        .join("\n")
    );
    return;
  }

  if (command === "run") {
    if (!arg1) usage();
    await runWorkflowById(workflows, arg1);
    return;
  }

  if (command === "preview") {
    if (!arg1) usage();
    const limit = arg2 ? Number(arg2) : undefined;
    await previewWorkflowById(workflows, arg1, { limit });
    return;
  }

  if (command === "schedule") {
    await scheduleAllWorkflows(workflows);
    return;
  }

  if (command === "schedule-allbao") {
    const time = arg1;
    await scheduleAllbao(workflows, { time, runOnStart: false });
    return;
  }

  usage();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
