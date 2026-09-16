#!/usr/bin/env node
// Offline dependency-free gradient boosting experiment for mercado D+1 forecasts.
// It reads data through the API and never writes to the database.

import fs from "node:fs";
import path from "node:path";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

const FEATURES = [
  "hour",
  "month",
  "weekday",
  "isWeekend",
  "festivoNacional",
  "demandaPrevista",
  "demandaResidual",
  "huecoTermicoD1",
  "eolica",
  "eolicaSobreDemandaPct",
  "solarPrevista",
  "solarSobreDemandaPct",
  "solarPctOfDailyMax",
  "solarDropFromDailyMax",
  "solarResidualDemandLow",
  "windPressurePct",
  "solarPressureHigh",
  "precioOmieLag24Night",
  "precioOmieLag48Night",
  "nuclearDisponibleMw",
  "nuclearDisponibleSobreDemandaPct",
  "nuclearPressureLow",
  "hidraulicaStorageIndex",
  "hidraulicaStoragePctOfMax",
  "hidraulicaStorageLow",
  "precioGasMibgas",
  "rampaDemanda",
  "rampaEolica",
  "rampaSolar",
  "rampaHuecoTermicoD1",
  "eveningThermalGapPressure",
  "eveningSolarExitThermalGap",
  "season_winter",
  "season_spring",
  "season_summer",
  "season_autumn"
];

const FEATURE_INDEX = new Map(FEATURES.map((feature, index) => [feature, index]));
const NUCLEAR_LOW = 7000;
const HYDRAULIC_REF = 15_500_000;
const HYDRAULIC_LOW = 12_500_000;

function parseArgs(argv) {
  const args = {
    baseUrl: "http://127.0.0.1:3000",
    username: process.env.REE_AUDITOR_USER || "operaciones",
    passwordEnv: "REE_AUDITOR_PASSWORD",
    tokenEnv: "REE_AUDITOR_TOKEN",
    trainFrom: "2025-01-01",
    trainTo: "2026-09-15",
    evalDays: "2026-09-16,2026-09-17",
    outputDir: "reports",
    estimators: 450,
    learningRate: 0.045,
    maxDepth: 3,
    bins: 40
  };
  for (let index = 2; index < argv.length; index += 1) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key.startsWith("--")) continue;
    index += 1;
    const normalized = key.slice(2).replace(/-([a-z])/g, (_, char) => char.toUpperCase());
    if (["estimators", "maxDepth", "bins"].includes(normalized)) args[normalized] = Number(value);
    else if (["learningRate"].includes(normalized)) args[normalized] = Number(value);
    else args[normalized] = value;
  }
  return args;
}

async function apiJson(baseUrl, route, token, options = {}) {
  const headers = { Accept: "application/json", ...(options.headers || {}) };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (options.body) headers["Content-Type"] = "application/json";
  const response = await fetch(`${baseUrl.replace(/\/$/, "")}${route}`, {
    method: options.method || "GET",
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`${response.status} ${response.statusText}: ${body.slice(0, 500)}`);
  }
  return response.json();
}

async function login(args) {
  const envToken = process.env[args.tokenEnv];
  if (envToken) return envToken;
  let password = process.env[args.passwordEnv];
  if (!password) {
    const rl = readline.createInterface({ input, output });
    password = await rl.question(`Password API para ${args.username}: `);
    rl.close();
  }
  const result = await apiJson(args.baseUrl, "/auth/login", null, {
    method: "POST",
    body: { username: args.username, password }
  });
  if (!result.token) throw new Error("Login sin token.");
  return result.token;
}

function query(params) {
  return new URLSearchParams(params).toString();
}

async function fetchDataset(args, token, from, to) {
  const result = await apiJson(args.baseUrl, `/mercado/dataset?${query({ fechaDesde: from, fechaHasta: to })}`, token);
  if (!Array.isArray(result.rows) || result.rows.length === 0) throw new Error("mercado/dataset no devolvio filas.");
  return result.rows.map((row) => ({ ...row })).sort((a, b) => String(a.timestampUtc).localeCompare(String(b.timestampUtc)));
}

async function fetchGas(args, token, from, to) {
  const officialParams = query({
    product: "GDAES_D+1",
    placeOfDelivery: "PVB",
    area: "ES",
    deliveryFrom: from,
    deliveryTo: to,
    take: 10000
  });
  const manualParams = query({
    product: "GDAES_D+1",
    placeOfDelivery: "PVB",
    area: "ES",
    deliveryFrom: from,
    deliveryTo: to,
    take: 10000
  });
  try {
    const [official, manual] = await Promise.all([
      apiJson(args.baseUrl, `/gas/mibgas/prices?${officialParams}`, token),
      apiJson(args.baseUrl, `/gas/mibgas/manual-prices?${manualParams}`, token)
    ]);
    const candidates = new Map();
    for (const row of official.rows || []) {
      if (row.firstDayDelivery && row.priceEurMwh !== null && row.priceEurMwh !== undefined) {
        const date = String(row.firstDayDelivery).slice(0, 10);
        const values = candidates.get(date) || [];
        values.push({ score: 1115, value: Number(row.priceEurMwh) });
        candidates.set(date, values);
      }
    }
    for (const row of manual.rows || []) {
      if (row.firstDayDelivery && row.priceEurMwh !== null && row.priceEurMwh !== undefined) {
        const date = String(row.firstDayDelivery).slice(0, 10);
        const values = candidates.get(date) || [];
        values.push({ score: 615, value: Number(row.priceEurMwh) });
        candidates.set(date, values);
      }
    }
    const prices = new Map();
    for (const [date, values] of candidates.entries()) {
      const bestScore = Math.max(...values.map((item) => item.score));
      const selected = values.filter((item) => item.score === bestScore);
      prices.set(date, mean(selected.map((item) => item.value)));
    }
    return prices;
  } catch (error) {
    console.warn(`AVISO: no pude cargar MIBGAS (${error.message}).`);
    return new Map();
  }
}

function num(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function round(value) {
  return Number.isFinite(value) ? Math.round(value * 1_000_000) / 1_000_000 : null;
}

function ratioPct(numerator, denominator) {
  return Number.isFinite(numerator) && Number.isFinite(denominator) && denominator !== 0 ? round((numerator / denominator) * 100) : null;
}

function positiveGap(value, threshold, divisor = 1) {
  return Number.isFinite(value) ? round(Math.max(0, threshold - value) / divisor) : null;
}

function positiveExcess(value, threshold) {
  return Number.isFinite(value) ? round(Math.max(0, value - threshold)) : null;
}

function subtractIfPresent(base, ...values) {
  if (!Number.isFinite(base) || values.some((value) => !Number.isFinite(value))) return null;
  return round(values.reduce((result, value) => result - value, base));
}

function dateAdd(date, days) {
  const parsed = new Date(`${date}T00:00:00.000Z`);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

function solarValue(row) {
  const solarPrevista = num(row.solarPrevista);
  if (Number.isFinite(solarPrevista)) return solarPrevista;
  const fotovoltaica = num(row.fotovoltaica);
  const termosolar = num(row.termosolar);
  if (!Number.isFinite(fotovoltaica)) return null;
  return round(fotovoltaica + (Number.isFinite(termosolar) ? termosolar : 0));
}

function enrichRows(rows, gasPrices) {
  const solarMaxByDate = new Map();
  const priceByDateHour = new Map();
  for (const row of rows) {
    const solar = solarValue(row);
    if (Number.isFinite(solar)) solarMaxByDate.set(row.date, Math.max(solarMaxByDate.get(row.date) || 0, solar));
    priceByDateHour.set(`${row.date}|${row.hour}`, num(row.precioOmie));
  }

  const enriched = rows.map((row) => {
    const hour = num(row.hour);
    const demanda = num(row.demandaPrevista);
    const eolica = num(row.eolica);
    const solar = solarValue(row);
    const nuclearDisponible = num(row.nuclearDisponibleMw);
    const storage = num(row.hidraulicaStorageIndex);
    const solarMax = solarMaxByDate.get(row.date) || null;
    const demandaResidual = subtractIfPresent(demanda, eolica, solar);
    const huecoTermicoD1 = subtractIfPresent(demanda, eolica, solar, nuclearDisponible);
    const solarSobreDemandaPct = ratioPct(solar, demanda);
    const eolicaSobreDemandaPct = ratioPct(eolica, demanda);
    const solarDropFromDailyMax = subtractIfPresent(solarMax, solar);
    const lag24 = priceByDateHour.get(`${dateAdd(row.date, -1)}|${hour}`) ?? null;
    const lag48 = priceByDateHour.get(`${dateAdd(row.date, -2)}|${hour}`) ?? null;
    const night = hour <= 8 || hour >= 20;
    const evening = hour >= 17 && hour <= 21;
    return {
      ...row,
      hour,
      month: num(row.month),
      weekday: num(row.weekday),
      isWeekend: row.isWeekend ? 1 : 0,
      festivoNacional: 0,
      precioOmie: num(row.precioOmie),
      demandaPrevista: demanda,
      eolica,
      solarPrevista: solar,
      nuclearDisponibleMw: nuclearDisponible,
      hidraulicaStorageIndex: storage,
      precioGasMibgas: gasPrices.get(row.date) ?? gasPrices.get(String(row.timestampUtc).slice(0, 10)) ?? null,
      demandaResidual,
      huecoTermicoD1,
      eolicaSobreDemandaPct,
      solarSobreDemandaPct,
      solarPctOfDailyMax: ratioPct(solar, solarMax),
      solarDropFromDailyMax,
      solarResidualDemandLow: solarSobreDemandaPct !== null && solarSobreDemandaPct >= 25 ? positiveGap(demandaResidual, 12_000, 1_000) : 0,
      windPressurePct: eolicaSobreDemandaPct,
      solarPressureHigh: positiveExcess(solarSobreDemandaPct, 55),
      precioOmieLag24Night: Number.isFinite(lag24) ? (night ? lag24 : 0) : null,
      precioOmieLag48Night: Number.isFinite(lag48) ? (night ? lag48 : 0) : null,
      nuclearDisponibleSobreDemandaPct: ratioPct(nuclearDisponible, demanda),
      nuclearPressureLow: positiveGap(nuclearDisponible, NUCLEAR_LOW, 100),
      hidraulicaStoragePctOfMax: ratioPct(storage, HYDRAULIC_REF),
      hidraulicaStorageLow: positiveGap(storage, HYDRAULIC_LOW, 1_000_000),
      rampaDemanda: null,
      rampaEolica: null,
      rampaSolar: null,
      rampaHuecoTermicoD1: null,
      eveningThermalGapPressure: evening && Number.isFinite(huecoTermicoD1) ? huecoTermicoD1 : 0,
      eveningSolarExitThermalGap: evening && Number.isFinite(huecoTermicoD1) && Number.isFinite(solarDropFromDailyMax) ? round(huecoTermicoD1 * solarDropFromDailyMax) : 0,
      season_winter: row.season === "winter" ? 1 : 0,
      season_spring: row.season === "spring" ? 1 : 0,
      season_summer: row.season === "summer" ? 1 : 0,
      season_autumn: row.season === "autumn" ? 1 : 0
    };
  });

  for (let index = 1; index < enriched.length; index += 1) {
    const prev = enriched[index - 1];
    const current = enriched[index];
    current.rampaDemanda = subtractIfPresent(current.demandaPrevista, prev.demandaPrevista);
    current.rampaEolica = subtractIfPresent(current.eolica, prev.eolica);
    current.rampaSolar = subtractIfPresent(current.solarPrevista, prev.solarPrevista);
    current.rampaHuecoTermicoD1 = subtractIfPresent(current.huecoTermicoD1, prev.huecoTermicoD1);
  }
  return enriched;
}

function rowToVector(row) {
  const vector = FEATURES.map((feature) => num(row[feature]));
  return vector.every(Number.isFinite) ? vector : null;
}

function buildMatrix(rows) {
  const result = [];
  for (const row of rows) {
    const vector = rowToVector(row);
    if (vector && Number.isFinite(row.precioOmie)) result.push({ row, x: vector, y: row.precioOmie });
  }
  return result;
}

function mean(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function varianceScore(sum, sumSq, count) {
  return sumSq - (sum * sum) / count;
}

function buildThresholds(samples, bins) {
  return FEATURES.map((_, featureIndex) => {
    const values = samples.map((sample) => sample.x[featureIndex]).filter(Number.isFinite).sort((a, b) => a - b);
    const thresholds = [];
    for (let bin = 1; bin < bins; bin += 1) {
      const index = Math.floor((values.length * bin) / bins);
      const value = values[index];
      if (Number.isFinite(value) && value !== thresholds[thresholds.length - 1]) thresholds.push(value);
    }
    return thresholds;
  });
}

function fitTree(samples, residuals, indices, thresholds, depth, maxDepth) {
  const values = indices.map((index) => residuals[index]);
  const leafValue = mean(values);
  if (depth >= maxDepth || indices.length < 40) return { value: leafValue };

  const parentSum = values.reduce((sum, value) => sum + value, 0);
  const parentSumSq = values.reduce((sum, value) => sum + value * value, 0);
  const parentScore = varianceScore(parentSum, parentSumSq, indices.length);
  let best = null;

  for (let featureIndex = 0; featureIndex < FEATURES.length; featureIndex += 1) {
    for (const threshold of thresholds[featureIndex]) {
      let leftCount = 0;
      let leftSum = 0;
      let leftSumSq = 0;
      let rightCount = 0;
      let rightSum = 0;
      let rightSumSq = 0;
      for (const sampleIndex of indices) {
        const residual = residuals[sampleIndex];
        if (samples[sampleIndex].x[featureIndex] <= threshold) {
          leftCount += 1;
          leftSum += residual;
          leftSumSq += residual * residual;
        } else {
          rightCount += 1;
          rightSum += residual;
          rightSumSq += residual * residual;
        }
      }
      if (leftCount < 20 || rightCount < 20) continue;
      const score = varianceScore(leftSum, leftSumSq, leftCount) + varianceScore(rightSum, rightSumSq, rightCount);
      const gain = parentScore - score;
      if (!best || gain > best.gain) best = { featureIndex, threshold, gain };
    }
  }

  if (!best || best.gain <= 1e-9) return { value: leafValue };
  const left = [];
  const right = [];
  for (const sampleIndex of indices) {
    if (samples[sampleIndex].x[best.featureIndex] <= best.threshold) left.push(sampleIndex);
    else right.push(sampleIndex);
  }
  return {
    featureIndex: best.featureIndex,
    threshold: best.threshold,
    left: fitTree(samples, residuals, left, thresholds, depth + 1, maxDepth),
    right: fitTree(samples, residuals, right, thresholds, depth + 1, maxDepth)
  };
}

function predictTree(tree, x) {
  if (Object.prototype.hasOwnProperty.call(tree, "value")) return tree.value;
  return predictTree(x[tree.featureIndex] <= tree.threshold ? tree.left : tree.right, x);
}

function trainBoosting(samples, args) {
  const base = mean(samples.map((sample) => sample.y));
  const predictions = new Array(samples.length).fill(base);
  const thresholds = buildThresholds(samples, args.bins);
  const trees = [];
  const indices = samples.map((_, index) => index);
  for (let iteration = 0; iteration < args.estimators; iteration += 1) {
    const residuals = samples.map((sample, index) => sample.y - predictions[index]);
    const tree = fitTree(samples, residuals, indices, thresholds, 0, args.maxDepth);
    trees.push(tree);
    for (let index = 0; index < samples.length; index += 1) {
      predictions[index] += args.learningRate * predictTree(tree, samples[index].x);
    }
  }
  return { base, trees, learningRate: args.learningRate };
}

function predictModel(model, x) {
  return model.trees.reduce((prediction, tree) => prediction + model.learningRate * predictTree(tree, x), model.base);
}

async function predictActive(args, token, day) {
  try {
    const models = (await apiJson(args.baseUrl, "/mercado/forecast/models", token)).models || [];
    const active = models.find((model) => model.activo === true);
    if (!active) return new Map();
    const result = await apiJson(args.baseUrl, "/mercado/forecast/predict/range", token, {
      method: "POST",
      body: { modeloId: active.id, fechaDesde: day, fechaHasta: day }
    });
    const hourly = result.predicciones?.[0]?.prediccionesHorarias || [];
    return new Map(hourly.map((row) => [row.datetimeLocal, { value: Number(row.precioPrevisto), version: active.version }]));
  } catch (error) {
    console.warn(`AVISO: no pude calcular activo por API (${error.message}).`);
    return new Map();
  }
}

function calcMetrics(rows, predKey) {
  const errors = rows.map((row) => row[predKey] - row.real).filter(Number.isFinite);
  return {
    rows: errors.length,
    MAE: mean(errors.map(Math.abs)),
    Bias: mean(errors),
    RMSE: Math.sqrt(mean(errors.map((error) => error * error)))
  };
}

function metricLine(label, metrics) {
  return `${label}: rows=${metrics.rows} MAE=${metrics.MAE.toFixed(2)} Bias=${metrics.Bias.toFixed(2)} RMSE=${metrics.RMSE.toFixed(2)}`;
}

function writeCsv(file, rows) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (rows.length === 0) return;
  const headers = Object.keys(rows[0]);
  const escape = (value) => {
    const text = value === null || value === undefined ? "" : String(value);
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  fs.writeFileSync(file, [headers.join(","), ...rows.map((row) => headers.map((header) => escape(row[header])).join(","))].join("\n"), "utf8");
}

async function main() {
  const args = parseArgs(process.argv);
  const evalDays = args.evalDays.split(",").map((day) => day.trim()).filter(Boolean);
  const contextFrom = dateAdd(args.trainFrom, -2);
  const dataTo = evalDays.reduce((maxDay, day) => (day > maxDay ? day : maxDay), args.trainTo);
  const token = await login(args);
  const [dataset, gasPrices] = await Promise.all([fetchDataset(args, token, contextFrom, dataTo), fetchGas(args, token, contextFrom, dataTo)]);
  const enriched = enrichRows(dataset, gasPrices);
  const trainRows = enriched.filter((row) => row.date >= args.trainFrom && row.date <= args.trainTo);
  const train = buildMatrix(trainRows);
  if (train.length < 500) throw new Error(`Entrenamiento demasiado pequeno: ${train.length} filas completas.`);
  console.log(`Entrenamiento node-gradient-boosting: ${train.length} filas, ${FEATURES.length} features`);
  console.log(`Gas MIBGAS cargado para ${gasPrices.size} dias`);
  const model = trainBoosting(train, args);
  const summary = [];

  for (const day of evalDays) {
    const samples = buildMatrix(enriched.filter((row) => row.date === day));
    const active = await predictActive(args, token, day);
    const rows = samples.map((sample) => {
      const activeRow = active.get(sample.row.datetimeLocal);
      return {
        hora: String(sample.row.datetimeLocal).slice(11, 16),
        boosting: round(predictModel(model, sample.x)),
        real: sample.y,
        activo: activeRow ? round(activeRow.value) : null,
        activeVersion: activeRow?.version || null
      };
    });
    for (const row of rows) {
      row.errorBoosting = round(row.boosting - row.real);
      row.errorActivo = Number.isFinite(row.activo) ? round(row.activo - row.real) : null;
    }
    const boostingMetrics = calcMetrics(rows, "boosting");
    summary.push({ fecha: day, modelo: "node-gradient-boosting", ...Object.fromEntries(Object.entries(boostingMetrics).map(([key, value]) => [key, round(value)])) });
    console.log(`\n${day}`);
    console.log(`  ${metricLine("node-gradient-boosting", boostingMetrics)}`);
    if (rows.some((row) => Number.isFinite(row.activo))) {
      const activeMetrics = calcMetrics(rows.filter((row) => Number.isFinite(row.activo)), "activo");
      const version = rows.find((row) => row.activeVersion)?.activeVersion || "?";
      summary.push({ fecha: day, modelo: `activo_v${version}`, ...Object.fromEntries(Object.entries(activeMetrics).map(([key, value]) => [key, round(value)])) });
      console.log(`  ${metricLine(`activo_v${version}`, activeMetrics)}`);
    }
    console.table(rows.map((row) => ({
      hora: row.hora,
      boosting: row.boosting?.toFixed(2),
      real: row.real?.toFixed(2),
      errorBoosting: row.errorBoosting?.toFixed(2),
      activo: Number.isFinite(row.activo) ? row.activo.toFixed(2) : "",
      errorActivo: Number.isFinite(row.errorActivo) ? row.errorActivo.toFixed(2) : ""
    })));
    writeCsv(path.join(args.outputDir, `mercado_node_boosting_${day}.csv`), rows);
  }
  writeCsv(path.join(args.outputDir, "mercado_node_boosting_summary.csv"), summary);
  console.log(`\nCSV escritos en ${path.resolve(args.outputDir)}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
