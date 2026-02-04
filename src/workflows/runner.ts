import { logger } from "../logger";
import { GoogleSheetsClient } from "../lib/googleSheets";
import { createSpinner } from "../cli/spinner";
import { fetchWorkflowItems } from "./sources";
import { fetchFxbaogaoArchive } from "./sources/fxbaogao";
import { getTransform } from "./transforms";
import { WorkflowConfig } from "./types";

function mapToSheetColumns(
  row: Record<string, unknown>,
  columns: Record<string, string>
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [sourceField, sheetColumn] of Object.entries(columns)) {
    out[sheetColumn] = row[sourceField] ?? null;
  }
  return out;
}

export async function runWorkflow(workflow: WorkflowConfig): Promise<void> {
  const spinner = createSpinner();
  const sheets = await GoogleSheetsClient.create();
  const transform = getTransform(workflow.transform);

  logger.info({ workflow: workflow.id }, "Running workflow");

  try {
    if (workflow.source.type === "fxbaogaoArchive" && workflow.source.upsertPerPage !== false) {
      const total: { updated: number; appended: number } = { updated: 0, appended: 0 };

      spinner.start(`Workflow ${workflow.id}: scraping pages...`);
      await fetchFxbaogaoArchive(workflow.source, {
        collectAll: false,
        onPageItems: async (p) => {
          spinner.update(
            `Fxbaogao: page ${p.page}/${p.totalPages} (${p.items.length} items) -> upserting...`
          );

          const transformed = p.items.map((it) => transform(it));
          const toUpsert = transformed.map((row) => mapToSheetColumns(row, workflow.sheets.columns));
          if (workflow.sheets.appendOnly) {
            const result = await sheets.appendNewByKey({
              spreadsheetId: workflow.sheets.spreadsheetId,
              sheetName: workflow.sheets.sheetName,
              keyColumn: workflow.sheets.keyColumn,
              rows: toUpsert,
              valueInputOption: "USER_ENTERED"
            });
            total.appended += result.appended;
          } else {
            const result = await sheets.upsertByKey({
              spreadsheetId: workflow.sheets.spreadsheetId,
              sheetName: workflow.sheets.sheetName,
              keyColumn: workflow.sheets.keyColumn,
              rows: toUpsert,
              valueInputOption: "USER_ENTERED"
            });

            total.updated += result.updated;
            total.appended += result.appended;
          }
        }
      });
      spinner.stop(
        `Workflow ${workflow.id}: done (updated=${total.updated}, appended=${total.appended})`
      );

      logger.info(
        { workflow: workflow.id, updated: total.updated, appended: total.appended },
        "Workflow complete"
      );
      return;
    }

    spinner.start(`Workflow ${workflow.id}: fetching items...`);
    const items = await fetchWorkflowItems(workflow, {
      onProgress: (p) => {
        spinner.setProgress(p.current, p.total);
        if (p.text) spinner.update(p.text);
      }
    });
    spinner.stop(`Workflow ${workflow.id}: fetched ${items.length} items`);

    spinner.start(`Workflow ${workflow.id}: transforming...`);
    const transformed = items.map((it) => transform(it));
    const toUpsert = transformed.map((row) => mapToSheetColumns(row, workflow.sheets.columns));
    spinner.stop(`Workflow ${workflow.id}: transformed ${toUpsert.length} rows`);

    spinner.start(`Workflow ${workflow.id}: upserting to Google Sheets...`);
    if (workflow.sheets.appendOnly) {
      const result = await sheets.appendNewByKey({
        spreadsheetId: workflow.sheets.spreadsheetId,
        sheetName: workflow.sheets.sheetName,
        keyColumn: workflow.sheets.keyColumn,
        rows: toUpsert,
        valueInputOption: "USER_ENTERED"
      });
      spinner.stop(
        `Workflow ${workflow.id}: done (appended=${result.appended}, skipped=${result.skipped})`
      );

      logger.info(
        { workflow: workflow.id, appended: result.appended, skipped: result.skipped },
        "Workflow complete"
      );
    } else {
      const result = await sheets.upsertByKey({
        spreadsheetId: workflow.sheets.spreadsheetId,
        sheetName: workflow.sheets.sheetName,
        keyColumn: workflow.sheets.keyColumn,
        rows: toUpsert,
        valueInputOption: "USER_ENTERED"
      });
      spinner.stop(
        `Workflow ${workflow.id}: done (updated=${result.updated}, appended=${result.appended})`
      );

      logger.info(
        { workflow: workflow.id, updated: result.updated, appended: result.appended },
        "Workflow complete"
      );
    }
  } catch (err) {
    spinner.stop(`Workflow ${workflow.id}: failed`);
    throw err;
  }
}

export async function runWorkflowById(workflows: WorkflowConfig[], id: string): Promise<void> {
  const wf = workflows.find((w) => w.id === id);
  if (!wf) throw new Error(`Workflow not found: ${id}`);
  if (!wf.enabled) throw new Error(`Workflow is disabled: ${id}`);
  await runWorkflow(wf);
}
