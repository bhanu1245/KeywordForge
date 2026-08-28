/**
 * CSV / Excel export (PRD §7 module 10, §8 flow 5).
 *
 * PRD §12 requires large exports to be background jobs, so these functions
 * write to disk and return a path; the HTTP layer only ever streams a
 * finished file. Nothing here holds a whole workbook for a million rows in
 * request memory.
 *
 * Storage is the local filesystem for MVP. The single `resolveExportPath`
 * indirection is where S3/R2 slots in for a real deployment.
 */

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import ExcelJS from "exceljs";
import type { KeywordRow } from "../keywords/service";

export const EXPORT_DIR = path.join(process.cwd(), "storage", "exports");

export function resolveExportPath(fileName: string): string {
  return path.join(EXPORT_DIR, fileName);
}

interface Column {
  header: string;
  width: number;
  value: (row: KeywordRow, clusterName?: string) => string | number | null;
}

const COLUMNS: Column[] = [
  { header: "Keyword", width: 44, value: (r) => r.text },
  { header: "Volume", width: 12, value: (r) => r.volume },
  { header: "Difficulty", width: 12, value: (r) => r.difficulty },
  { header: "Intent", width: 16, value: (r) => r.intent },
  { header: "CPC (USD)", width: 12, value: (r) => r.cpc },
  { header: "Competition", width: 13, value: (r) => r.competition },
  { header: "Opportunity", width: 13, value: (r) => r.opportunity },
  { header: "Traffic Potential", width: 17, value: (r) => r.trafficPotential },
  { header: "Est. Monthly Value (USD)", width: 24, value: (r) => r.commercialValue },
  { header: "Words", width: 8, value: (r) => r.wordCount },
  { header: "Question", width: 10, value: (r) => (r.isQuestion ? "yes" : "no") },
  { header: "Cluster", width: 32, value: (_r, cluster) => cluster ?? "" },
];

/** RFC 4180 escaping — quote when the value contains a delimiter or quote. */
function csvCell(value: string | number | null): string {
  if (value === null || value === undefined) return "";
  const s = String(value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function buildCsv(
  rows: KeywordRow[],
  clusterNames?: Map<string, string>,
): string {
  const lines = [COLUMNS.map((c) => csvCell(c.header)).join(",")];
  for (const row of rows) {
    const cluster = clusterNames?.get(row.projectKeywordId);
    lines.push(COLUMNS.map((c) => csvCell(c.value(row, cluster))).join(","));
  }
  // Excel on Windows needs the BOM to read UTF-8 accented keywords correctly.
  return `﻿${lines.join("\r\n")}\r\n`;
}

export async function writeCsvExport(
  fileName: string,
  rows: KeywordRow[],
  clusterNames?: Map<string, string>,
): Promise<string> {
  await mkdir(EXPORT_DIR, { recursive: true });
  const filePath = resolveExportPath(fileName);
  await writeFile(filePath, buildCsv(rows, clusterNames), "utf8");
  return filePath;
}

export async function writeXlsxExport(
  fileName: string,
  rows: KeywordRow[],
  clusterNames?: Map<string, string>,
  meta?: { projectName?: string; clientName?: string },
): Promise<string> {
  await mkdir(EXPORT_DIR, { recursive: true });
  const filePath = resolveExportPath(fileName);

  // Streaming writer: rows are flushed as they are committed rather than held
  // in memory, which is what makes a 100K-row export survivable.
  const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({
    filename: filePath,
    useStyles: true,
  });
  workbook.creator = "KeywordForge";
  workbook.created = new Date();

  const sheet = workbook.addWorksheet("Keywords", {
    views: [{ state: "frozen", ySplit: 1 }],
  });
  sheet.columns = COLUMNS.map((c) => ({ header: c.header, width: c.width }));

  const headerRow = sheet.getRow(1);
  headerRow.font = { bold: true, color: { argb: "FFFFFFFF" } };
  headerRow.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FF1F2937" },
  };
  headerRow.commit();

  for (const row of rows) {
    const cluster = clusterNames?.get(row.projectKeywordId);
    sheet.addRow(COLUMNS.map((c) => c.value(row, cluster))).commit();
  }
  sheet.commit();

  if (meta?.projectName) {
    const info = workbook.addWorksheet("About");
    info.columns = [{ width: 26 }, { width: 60 }];
    info.addRow(["Project", meta.projectName]).commit();
    info.addRow(["Client", meta.clientName ?? ""]).commit();
    info.addRow(["Exported", new Date().toISOString()]).commit();
    info.addRow(["Rows", rows.length]).commit();
    info
      .addRow([
        "Note",
        "Difficulty is a proxy score computed from competition, volume and phrase length — not an Ahrefs/Moz KD.",
      ])
      .commit();
    info.commit();
  }

  await workbook.commit();
  return filePath;
}
