import { google, sheets_v4 } from "googleapis";
import { getConfig } from "../config";
import fs from "node:fs/promises";

type SheetTable = {
  headers: string[];
  rows: string[][];
};

function asString(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

function columnNumberToName(n: number): string {
  let result = "";
  let num = n;
  while (num > 0) {
    const rem = (num - 1) % 26;
    result = String.fromCharCode(65 + rem) + result;
    num = Math.floor((num - 1) / 26);
  }
  return result || "A";
}

function sheetNameToA1(sheetName: string): string {
  const escaped = sheetName.replace(/'/g, "''");
  return `'${escaped}'`;
}

function toA1(sheetName: string, rowNumber1Based: number, colCount: number): string {
  const startCol = "A";
  const endCol = columnNumberToName(colCount);
  return `${sheetNameToA1(sheetName)}!${startCol}${rowNumber1Based}:${endCol}${rowNumber1Based}`;
}

export class GoogleSheetsClient {
  private sheets: sheets_v4.Sheets;

  constructor(sheets: sheets_v4.Sheets) {
    this.sheets = sheets;
  }

  static async create(): Promise<GoogleSheetsClient> {
    const config = getConfig();
    const scopes = ["https://www.googleapis.com/auth/spreadsheets"];

    let credentials: any | undefined;
    if (config.googleServiceAccountJson) {
      credentials = JSON.parse(config.googleServiceAccountJson);
    } else if (config.googleApplicationCredentials) {
      const raw = await fs.readFile(config.googleApplicationCredentials, "utf8");
      credentials = JSON.parse(raw);
    } else {
      throw new Error(
        "Missing Google credentials. Set GOOGLE_SERVICE_ACCOUNT_JSON or GOOGLE_APPLICATION_CREDENTIALS in .env."
      );
    }

    const auth = new google.auth.GoogleAuth({ scopes, credentials });

    const sheets = google.sheets({ version: "v4", auth });
    return new GoogleSheetsClient(sheets);
  }

  async readTable(spreadsheetId: string, sheetName: string): Promise<SheetTable> {
    const res = await this.sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${sheetNameToA1(sheetName)}!A1:ZZ`
    });
    const values = (res.data.values || []) as unknown[][];

    if (values.length === 0) return { headers: [], rows: [] };
    const headers = values[0].map((v) => asString(v));
    const rows = values.slice(1).map((row) => row.map((v) => asString(v)));
    return { headers, rows };
  }

  async upsertByKey(params: {
    spreadsheetId: string;
    sheetName: string;
    keyColumn: string;
    rows: Array<Record<string, unknown>>;
    valueInputOption?: "RAW" | "USER_ENTERED";
  }): Promise<{ updated: number; appended: number }> {
    const valueInputOption = params.valueInputOption || "USER_ENTERED";
    const table = await this.readTable(params.spreadsheetId, params.sheetName);

    if (table.headers.length === 0) {
      throw new Error(
        `Sheet "${params.sheetName}" is empty; first row must contain headers (including "${params.keyColumn}").`
      );
    }

    const headerIndex = new Map<string, number>();
    table.headers.forEach((h, i) => {
      headerIndex.set(h, i);
      const trimmed = h.trim();
      if (trimmed !== h && !headerIndex.has(trimmed)) headerIndex.set(trimmed, i);
    });
    const keyIndex = headerIndex.get(params.keyColumn);
    if (keyIndex === undefined) {
      throw new Error(
        `Cannot find key column "${params.keyColumn}" in sheet headers: ${JSON.stringify(
          table.headers
        )}`
      );
    }

    const existingByKey = new Map<string, { rowNumber: number; row: string[] }>();
    table.rows.forEach((row, i) => {
      const key = row[keyIndex] || "";
      if (key) existingByKey.set(key, { rowNumber: i + 2, row }); // +2 because header is row 1
    });

    const updates: Array<{ range: string; values: string[][] }> = [];
    const appends: string[][] = [];

    for (const inputRow of params.rows) {
      const keyValue = asString(inputRow[params.keyColumn]);
      if (!keyValue) continue;

      const target = existingByKey.get(keyValue);
      if (target) {
        const merged = new Array(table.headers.length).fill("");
        for (let i = 0; i < table.headers.length; i++) merged[i] = target.row[i] || "";

        for (const [colName, value] of Object.entries(inputRow)) {
          const idx = headerIndex.get(colName);
          if (idx === undefined) continue;
          merged[idx] = asString(value);
        }

        updates.push({
          range: toA1(params.sheetName, target.rowNumber, table.headers.length),
          values: [merged]
        });
      } else {
        const newRow = new Array(table.headers.length).fill("");
        for (const [colName, value] of Object.entries(inputRow)) {
          const idx = headerIndex.get(colName);
          if (idx === undefined) continue;
          newRow[idx] = asString(value);
        }
        appends.push(newRow);
      }
    }

    if (updates.length > 0) {
      await this.sheets.spreadsheets.values.batchUpdate({
        spreadsheetId: params.spreadsheetId,
        requestBody: {
          valueInputOption,
          data: updates
        }
      });
    }

    if (appends.length > 0) {
      await this.sheets.spreadsheets.values.append({
        spreadsheetId: params.spreadsheetId,
        range: `${sheetNameToA1(params.sheetName)}!A1`,
        valueInputOption,
        insertDataOption: "INSERT_ROWS",
        requestBody: {
          values: appends
        }
      });
    }

    return { updated: updates.length, appended: appends.length };
  }

  async appendNewByKey(params: {
    spreadsheetId: string;
    sheetName: string;
    keyColumn: string;
    rows: Array<Record<string, unknown>>;
    valueInputOption?: "RAW" | "USER_ENTERED";
  }): Promise<{ appended: number; skipped: number }> {
    const valueInputOption = params.valueInputOption || "USER_ENTERED";
    const table = await this.readTable(params.spreadsheetId, params.sheetName);

    if (table.headers.length === 0) {
      throw new Error(
        `Sheet "${params.sheetName}" is empty; first row must contain headers (including "${params.keyColumn}").`
      );
    }

    const headerIndex = new Map<string, number>();
    table.headers.forEach((h, i) => {
      headerIndex.set(h, i);
      const trimmed = h.trim();
      if (trimmed !== h && !headerIndex.has(trimmed)) headerIndex.set(trimmed, i);
    });
    const keyIndex = headerIndex.get(params.keyColumn);
    if (keyIndex === undefined) {
      throw new Error(
        `Cannot find key column "${params.keyColumn}" in sheet headers: ${JSON.stringify(
          table.headers
        )}`
      );
    }

    const existingKeys = new Set<string>();
    table.rows.forEach((row) => {
      const key = row[keyIndex] || "";
      if (key) existingKeys.add(key);
    });

    const appends: string[][] = [];
    let skipped = 0;

    for (const inputRow of params.rows) {
      const keyValue = asString(inputRow[params.keyColumn]);
      if (!keyValue) continue;
      if (existingKeys.has(keyValue)) {
        skipped += 1;
        continue;
      }

      const newRow = new Array(table.headers.length).fill("");
      for (const [colName, value] of Object.entries(inputRow)) {
        const idx = headerIndex.get(colName);
        if (idx === undefined) continue;
        newRow[idx] = asString(value);
      }
      appends.push(newRow);
      existingKeys.add(keyValue);
    }

    if (appends.length > 0) {
      await this.sheets.spreadsheets.values.append({
        spreadsheetId: params.spreadsheetId,
        range: `${sheetNameToA1(params.sheetName)}!A1`,
        valueInputOption,
        insertDataOption: "INSERT_ROWS",
        requestBody: {
          values: appends
        }
      });
    }

    return { appended: appends.length, skipped };
  }
}
