// Ported 1:1 from the validated Python reference parser (see project memory /
// CLAUDE.md "Workbook structure" section for the source-of-truth rules). Every
// arithmetic identity below (labor cost, expense, revenue, COGS, operating income,
// net income) was cross-checked against the actual 25/26년 복사 workbooks before
// this port -- keep any future rule changes mirrored in both places.
import * as XLSX from "npm:xlsx@0.18.5";

function norm(s: unknown): string {
  if (s === null || s === undefined) return "";
  return String(s).replace(/\s+/g, "");
}

const MONTH_RE = /^(\d{1,2})월$/;

export interface LineItem {
  category_major: string;
  category_mid: string;
  category_sub: string | null;
  counterparty: string | null;
  detail: string | null;
  months: Record<number, number>;
  ratios: Record<number, number | null>;
  is_subtotal: boolean;
}

export interface SummaryMetric {
  label: string;
  months: Record<number, number>;
}

export interface ParseResult {
  detectedYear: string | null;
  monthCols: number[];
  cutoffMonth: number;
  lineItems: LineItem[];
  summaryMetrics: SummaryMetric[];
}

function cellAt(ws: XLSX.WorkSheet, row: number, col: number): unknown {
  const addr = XLSX.utils.encode_cell({ r: row - 1, c: col - 1 });
  const cell = ws[addr];
  return cell ? cell.v : undefined;
}

function colCount(ws: XLSX.WorkSheet): number {
  const ref = ws["!ref"];
  if (!ref) return 0;
  const range = XLSX.utils.decode_range(ref);
  return range.e.c + 1;
}

function rowCount(ws: XLSX.WorkSheet): number {
  const ref = ws["!ref"];
  if (!ref) return 0;
  const range = XLSX.utils.decode_range(ref);
  return range.e.r + 1;
}

export function parsePnlWorkbook(bytes: Uint8Array): ParseResult {
  const wb = XLSX.read(bytes, { type: "array", cellDates: false });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const maxCol = colCount(ws);
  const maxRow = rowCount(ws);

  // locate header row (first row containing normalized "대분류")
  let headerRow: number | null = null;
  for (let r = 1; r <= Math.min(10, maxRow); r++) {
    for (let c = 1; c <= maxCol; c++) {
      if (norm(cellAt(ws, r, c)) === "대분류") {
        headerRow = r;
        break;
      }
    }
    if (headerRow) break;
  }
  if (!headerRow) throw new Error("헤더 행(대분류)을 찾지 못했습니다");

  // detected fiscal year from the banner rows above the header (e.g. "2026년 (귀속월 기준)")
  let detectedYear: string | null = null;
  for (let r = 1; r < headerRow; r++) {
    for (let c = 1; c <= maxCol; c++) {
      const v = cellAt(ws, r, c);
      const m = typeof v === "string" && v.match(/(20\d{2})년/);
      if (m) {
        detectedYear = m[1].slice(2);
        break;
      }
    }
    if (detectedYear) break;
  }

  // month columns
  const monthCols: Record<number, { col: number; ratioCol: number | null }> = {};
  for (let c = 1; c <= maxCol; c++) {
    const h = norm(cellAt(ws, headerRow, c));
    const m = h.match(MONTH_RE);
    if (m) {
      const monthNum = parseInt(m[1], 10);
      const nxt = norm(cellAt(ws, headerRow, c + 1));
      const ratioCol = nxt.includes("비율계상") ? c + 1 : null;
      monthCols[monthNum] = { col: c, ratioCol };
    }
  }
  if (Object.keys(monthCols).length === 0) {
    throw new Error("월별 열(1월..12월)을 찾지 못했습니다");
  }

  // end row: first row after header where column B starts with "◎"
  let endRow = maxRow;
  for (let r = headerRow + 1; r <= maxRow; r++) {
    const b = cellAt(ws, r, 2);
    if (typeof b === "string" && b.trim().startsWith("◎")) {
      endRow = r - 1;
      break;
    }
  }

  function monthsVec(r: number): Record<number, number> {
    const vec: Record<number, number> = {};
    for (const [m, info] of Object.entries(monthCols)) {
      const v = cellAt(ws, r, info.col);
      vec[Number(m)] = typeof v === "number" ? v : 0;
    }
    return vec;
  }

  function ratioVec(r: number): Record<number, number | null> {
    const vec: Record<number, number | null> = {};
    for (const [m, info] of Object.entries(monthCols)) {
      if (info.ratioCol) {
        const v = cellAt(ws, r, info.ratioCol);
        vec[Number(m)] = typeof v === "number" ? v : null;
      }
    }
    return vec;
  }

  const cur: Record<"C" | "D" | "E" | "F", string | null> = {
    C: null,
    D: null,
    E: null,
    F: null,
  };
  const summaryMetrics: SummaryMetric[] = [];
  const lineItems: LineItem[] = [];
  const cum = new Map<string, Record<number, number>>();

  const isBlank = (v: unknown) => v === null || v === undefined || String(v).trim() === "";

  for (let r = headerRow + 1; r <= endRow; r++) {
    const cVal = cellAt(ws, r, 3);
    const dVal = cellAt(ws, r, 4);
    const eVal = cellAt(ws, r, 5);
    const fVal = cellAt(ws, r, 6);
    const gVal = cellAt(ws, r, 7);
    const bVal = cellAt(ws, r, 2);

    if (!isBlank(cVal)) cur.C = String(cVal);
    if (!isBlank(dVal)) cur.D = String(dVal);
    if (!isBlank(eVal)) cur.E = String(eVal);
    if (!isBlank(fVal)) cur.F = String(fVal);

    if (!isBlank(bVal) && typeof bVal !== "number") {
      summaryMetrics.push({ label: norm(bVal), months: monthsVec(r) });
      continue;
    }

    const eNorm = norm(eVal);
    const gNorm = norm(gVal);

    if (eNorm.includes("합계")) {
      const groupKey = `E|${norm(cur.C)}|${norm(cur.D)}`;
      const vec = monthsVec(r);
      const prevCum = cum.get(groupKey) ?? {};
      const monthsList = Object.keys(monthCols).map(Number);
      const hasPrev = monthsList.some((m) => (prevCum[m] ?? 0) !== 0);
      const isRollup = hasPrev && monthsList.every((m) => Math.abs(vec[m] - (prevCum[m] ?? 0)) < 0.5);
      if (isRollup) continue;
      lineItems.push({
        category_major: cur.C!,
        category_mid: cur.D!,
        category_sub: eVal != null ? String(eVal) : null,
        counterparty: null,
        detail: null,
        months: vec,
        ratios: ratioVec(r),
        is_subtotal: true,
      });
      const newCum: Record<number, number> = {};
      for (const m of monthsList) newCum[m] = (prevCum[m] ?? 0) + vec[m];
      cum.set(groupKey, newCum);
      continue;
    }

    if (gNorm.includes("합계")) {
      const groupKey = `G|${norm(cur.C)}|${norm(cur.D)}|${norm(cur.E)}`;
      const vec = monthsVec(r);
      const prevCum = cum.get(groupKey) ?? {};
      const monthsList = Object.keys(monthCols).map(Number);
      const hasPrev = monthsList.some((m) => (prevCum[m] ?? 0) !== 0);
      const isRollup = hasPrev && monthsList.every((m) => Math.abs(vec[m] - (prevCum[m] ?? 0)) < 0.5);
      if (isRollup) continue;
      lineItems.push({
        category_major: cur.C!,
        category_mid: cur.D!,
        category_sub: cur.E,
        counterparty: cur.F,
        detail: gVal != null ? String(gVal) : null,
        months: vec,
        ratios: ratioVec(r),
        is_subtotal: true,
      });
      const newCum: Record<number, number> = {};
      for (const m of monthsList) newCum[m] = (prevCum[m] ?? 0) + vec[m];
      cum.set(groupKey, newCum);
      continue;
    }

    if (
      gNorm !== "" &&
      (gNorm.includes("미포함") || gNorm.includes("이익") || gNorm.includes("순이익")) &&
      !gNorm.includes("합계")
    ) {
      summaryMetrics.push({ label: gNorm, months: monthsVec(r) });
      continue;
    }

    if (gNorm !== "") {
      // raw (unaggregated) vendor/detail row -- kept alongside its subtotal for
      // drill-down views; never summed as a subtotal itself (is_subtotal=false)
      lineItems.push({
        category_major: cur.C!,
        category_mid: cur.D!,
        category_sub: cur.E,
        counterparty: cur.F,
        detail: gVal != null ? String(gVal) : null,
        months: monthsVec(r),
        ratios: ratioVec(r),
        is_subtotal: false,
      });
    }
  }

  const revenueMetric = summaryMetrics.find(
    (m) => m.label.includes("매출") && m.label.includes("합계"),
  );
  let cutoffMonth = 0;
  if (revenueMetric) {
    for (let m = 1; m <= 12; m++) {
      if (revenueMetric.months[m]) cutoffMonth = m;
    }
  }

  return {
    detectedYear,
    monthCols: Object.keys(monthCols).map(Number).sort((a, b) => a - b),
    cutoffMonth,
    lineItems,
    summaryMetrics,
  };
}
