#!/usr/bin/env node

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

const args = parseArgs(process.argv.slice(2));
const baseUrl = String(args["base-url"] ?? "http://127.0.0.1:3000").replace(/\/+$/, "");
const username = String(args.username ?? "operaciones");
const date = String(args.date ?? madridTomorrow());
const scope = String(args.scope ?? "all");
const delayMs = Number(args["delay-ms"] ?? 150);
const limit = args.limit === undefined ? null : Number(args.limit);
const syncCatalog = Boolean(args["sync-catalog"]);

if (!["all", "has-data", "active"].includes(scope)) {
  fail("--scope debe ser all, has-data o active.");
}
if (limit !== null && (!Number.isSafeInteger(limit) || limit < 1)) {
  fail("--limit debe ser un entero positivo.");
}
if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
  fail("--date debe tener formato YYYY-MM-DD.");
}

const password = String(args.password ?? process.env.API_PASSWORD ?? (await askPassword(username)));
const headers = await login(username, password);

if (syncCatalog) {
  console.log("Sincronizando catalogo ESIOS...");
  const sync = await postJson("/esios/indicators/sync", undefined, headers);
  console.log(`Catalogo sincronizado: ${sync.savedRecords ?? "?"} guardados.`);
}

const indicators = await getJson("/esios/indicators", headers);
const selected = indicators
  .filter((indicator) => {
    if (scope === "has-data") {
      return indicator.hasData;
    }
    if (scope === "active") {
      return indicator.active !== false;
    }
    return true;
  })
  .slice(0, limit ?? undefined);

console.log(`Barrido ESIOS D+1 ${date}: ${selected.length}/${indicators.length} indicadores scope=${scope}.`);

const results = [];
for (const [index, indicator] of selected.entries()) {
  const prefix = `${index + 1}/${selected.length} ${indicator.indicatorId}`;
  try {
    const summary = await postJson(`/esios/indicators/${indicator.indicatorId}/download`, { startDate: date, endDate: date }, headers);
    const row = {
      indicatorId: indicator.indicatorId,
      name: indicator.name ?? "",
      shortName: indicator.shortName ?? "",
      unit: indicator.unit ?? "",
      frequency: indicator.frequency ?? "",
      status: summary.status,
      downloadedRecords: summary.downloadedRecords ?? 0,
      insertedRecords: summary.insertedRecords ?? 0,
      updatedRecords: summary.updatedRecords ?? 0,
      executionTimeMs: summary.executionTimeMs ?? 0,
      errorMessage: summary.errorMessage ?? ""
    };
    results.push(row);
    console.log(`${prefix} ${row.downloadedRecords > 0 ? "OK" : "VACIO"} records=${row.downloadedRecords}`);
  } catch (error) {
    const row = {
      indicatorId: indicator.indicatorId,
      name: indicator.name ?? "",
      shortName: indicator.shortName ?? "",
      unit: indicator.unit ?? "",
      frequency: indicator.frequency ?? "",
      status: "ERROR",
      downloadedRecords: 0,
      insertedRecords: 0,
      updatedRecords: 0,
      executionTimeMs: 0,
      errorMessage: error instanceof Error ? error.message : String(error)
    };
    results.push(row);
    console.log(`${prefix} ERROR ${row.errorMessage}`);
  }
  if (delayMs > 0 && index < selected.length - 1) {
    await sleep(delayMs);
  }
}

const withData = results.filter((row) => row.downloadedRecords > 0);
const errors = results.filter((row) => row.status === "ERROR");
const reportsDir = path.resolve("reports");
await mkdir(reportsDir, { recursive: true });
const stem = `esios-d1-indicator-sweep-${date}`;
await writeFile(path.join(reportsDir, `${stem}.json`), JSON.stringify({ date, scope, total: results.length, withData: withData.length, errors: errors.length, results }, null, 2), "utf8");
await writeFile(path.join(reportsDir, `${stem}.csv`), toCsv(results), "utf8");

console.log("");
console.log(`Con datos para ${date}: ${withData.length}/${results.length}. Errores: ${errors.length}.`);
console.table(withData.slice(0, 50).map((row) => ({
  id: row.indicatorId,
  records: row.downloadedRecords,
  name: row.name.slice(0, 80),
  unit: row.unit,
  frequency: row.frequency
})));
console.log(`CSV: ${path.join(reportsDir, `${stem}.csv`)}`);
console.log(`JSON: ${path.join(reportsDir, `${stem}.json`)}`);

async function askPassword(user) {
  const rl = readline.createInterface({ input, output });
  try {
    return await rl.question(`Password API para ${user}: `);
  } finally {
    rl.close();
  }
}

async function login(user, pass) {
  const response = await fetch(`${baseUrl}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: user, password: pass })
  });
  if (!response.ok) {
    throw new Error(`Login fallido HTTP ${response.status}: ${await response.text()}`);
  }
  const data = await response.json();
  return { Authorization: `Bearer ${data.token}` };
}

async function getJson(route, authHeaders) {
  const response = await fetch(`${baseUrl}${route}`, { headers: authHeaders });
  if (!response.ok) {
    throw new Error(`GET ${route} HTTP ${response.status}: ${await response.text()}`);
  }
  return response.json();
}

async function postJson(route, body, authHeaders) {
  const response = await fetch(`${baseUrl}${route}`, {
    method: "POST",
    headers: { ...authHeaders, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  if (!response.ok) {
    throw new Error(`POST ${route} HTTP ${response.status}: ${await response.text()}`);
  }
  return response.json();
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (!item.startsWith("--")) {
      continue;
    }
    const key = item.slice(2);
    const next = argv[index + 1];
    if (next === undefined || next.startsWith("--")) {
      parsed[key] = true;
      continue;
    }
    parsed[key] = next;
    index += 1;
  }
  return parsed;
}

function madridTomorrow() {
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Madrid",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
  const dateValue = new Date(`${today}T00:00:00.000Z`);
  dateValue.setUTCDate(dateValue.getUTCDate() + 1);
  return dateValue.toISOString().slice(0, 10);
}

function toCsv(rows) {
  const columns = ["indicatorId", "name", "shortName", "unit", "frequency", "status", "downloadedRecords", "insertedRecords", "updatedRecords", "executionTimeMs", "errorMessage"];
  return `${columns.join(";")}\n${rows.map((row) => columns.map((column) => csvCell(row[column])).join(";")).join("\n")}\n`;
}

function csvCell(value) {
  const text = String(value ?? "");
  return /[;"\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
