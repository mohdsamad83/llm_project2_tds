// lib/data.js
import axios from "axios";
import { parse as csvParse } from "papaparse";
import * as XLSX from "xlsx";
import pdfParse from "pdf-parse";

/** fetchResource */
export async function fetchResource(url) {
  const resp = await axios.get(url, { responseType: "arraybuffer", timeout: 45000 });
  const contentType = resp.headers["content-type"] || "";
  const buffer = Buffer.from(resp.data);
  return { contentType, size: buffer.length, buffer };
}

/** parseCsvBufferToJson */
export function parseCsvBufferToJson(buffer, limitRows = 10000) {
  const text = buffer.toString("utf8");
  const parsed = csvParse(text, { header: true, dynamicTyping: true });
  const data = parsed.data;
  if (Array.isArray(data) && data.length > limitRows) return { data: data.slice(0, limitRows), truncated: true, totalRows: data.length };
  return { data, truncated: false, totalRows: data.length };
}

/** parseJsonBuffer */
export function parseJsonBuffer(buffer) {
  const text = buffer.toString("utf8");
  return { data: JSON.parse(text) };
}

/** parseXlsxBuffer */
export function parseXlsxBuffer(buffer) {
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: null });
  return { data: rows };
}

/** parsePdfBuffer */
export async function parsePdfBuffer(buffer) {
  try {
    const result = await pdfParse(buffer);
    return { text: result.text };
  } catch (e) {
    return { text: "" };
  }
}

/** fetchAndParse */
export async function fetchAndParse(url) {
  const { contentType, size, buffer } = await fetchResource(url);
  const lower = contentType.toLowerCase();

  if (lower.includes("text/csv") || url.toLowerCase().endsWith(".csv")) return { type: "csv", size, parsed: parseCsvBufferToJson(buffer) };
  if (lower.includes("application/json") || url.toLowerCase().endsWith(".json")) return { type: "json", size, parsed: parseJsonBuffer(buffer) };
  if (lower.includes("spreadsheet") || url.toLowerCase().endsWith(".xlsx") || url.toLowerCase().endsWith(".xls")) return { type: "excel", size, parsed: parseXlsxBuffer(buffer) };
  if (lower.includes("pdf") || url.toLowerCase().endsWith(".pdf")) return { type: "pdf", size, parsed: await parsePdfBuffer(buffer) };

  const asText = buffer.toString("utf8").slice(0, 2000);
  if (asText.includes(",") || asText.includes("\n")) {
    try { const csv = parseCsvBufferToJson(buffer); return { type: "csv", size, parsed: csv }; } catch {}
  }

  return { type: "binary", size, parsed: null };
}
