import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { AuthService } from "../auth/auth.service";
import { CONSUMPTION_HEADERS, normalizeConsumption, parseSipsCsv, PS_HEADERS, publicPs, readSipsCsv, SipsCsvError } from "./sips-csv";
import { normalizeCups, validateCups } from "./cups-validation";
import { SipsService, validCups } from "./sips.service";

const originalFetch = global.fetch;
const originalKey = process.env.CNMC_CONFIG_ENCRYPTION_KEY;
process.env.CNMC_CONFIG_ENCRYPTION_KEY = "sips-test-encryption-key";
void after(() => { global.fetch = originalFetch; if (originalKey === undefined) delete process.env.CNMC_CONFIG_ENCRYPTION_KEY; else process.env.CNMC_CONFIG_ENCRYPTION_KEY = originalKey; });

void test("las dos muestras reales conservan 103 y 30 columnas y no mezclan CUPS", () => {
  assert.equal(PS_HEADERS.length, 103); assert.equal(CONSUMPTION_HEADERS.length, 30);
  const psPath = join(homedir(), "Downloads", "Respuesta Datos cups.csv");
  const consumptionPath = join(homedir(), "Downloads", "Respuesta Consumos.csv");
  if (!existsSync(psPath) || !existsSync(consumptionPath)) return;
  const psCsv = readFileSync(psPath, "utf8"); const consumptionCsv = readFileSync(consumptionPath, "utf8");
  const psCups = /"(ES[A-Z0-9]+)"/.exec(psCsv)?.[1] ?? "";
  const consumptionCups = /"(ES[A-Z0-9]+)"/.exec(consumptionCsv)?.[1] ?? "";
  assert.notEqual(psCups, consumptionCups);
  const ps = parseSipsCsv(psCsv, "PS", psCups); const records = parseSipsCsv(consumptionCsv, "CONSUMPTION", consumptionCups);
  assert.equal(Object.keys(ps[0]).length, 103); assert.equal(Object.keys(records[0]).length, 30);
  assert.ok(records.length > 1);
  assert.throws(() => parseSipsCsv(consumptionCsv, "CONSUMPTION", psCups), (error) => error instanceof SipsCsvError && error.code === "CUPS_MISMATCH");
  const first = normalizeConsumption(records[0]);
  assert.equal(first.totals.active, 4164);
  assert.equal(first.totals.inductive, 1004);
  assert.equal(first.totals.demandMax, 18.972);
});

void test("CSV vacío, mensaje HTTP 200 y campos de titular", () => {
  const cups = "ES0022000007748077EP1P";
  assert.throws(() => parseSipsCsv("No se han encontrado resultados", "PS", cups), (error) => error instanceof SipsCsvError && error.code === "NO_RESULTS");
  assert.throws(() => parseSipsCsv("cups,bad\nother,value", "PS", cups), (error) => error instanceof SipsCsvError && error.code === "INVALID_CSV");
  assert.deepEqual(publicPs({ cups, nombreTitular: "Persona", idTitular: "123", codigoTarifaATREnVigor: "019" }), { cups, codigoTarifaATREnVigor: "019" });
  assert.equal(validCups(cups), cups); assert.throws(() => validCups("ES123"));
});

void test("CSV CNMC respeta UTF-8 y Windows-1252 sin caracteres de sustitución", async () => {
  const utf8 = new Response('"Distribuidora Eléctrica"', { headers: { "content-type": "text/csv; charset=utf-8" } });
  const latin1 = new Response(Uint8Array.from([68, 105, 115, 116, 114, 105, 98, 117, 105, 100, 111, 114, 97, 32, 69, 108, 233, 99, 116, 114, 105, 99, 97]), { headers: { "content-type": "text/csv; charset=windows-1252" } });
  const latin1WithoutHeader = new Response(Uint8Array.from([69, 108, 233, 99, 116, 114, 105, 99, 97]));
  assert.equal(await readSipsCsv(utf8), '"Distribuidora Eléctrica"');
  assert.equal(await readSipsCsv(latin1), "Distribuidora Eléctrica");
  assert.equal(await readSipsCsv(latin1WithoutHeader), "Eléctrica");
});

function calculatedCups(digits: string, suffix = "") {
  const letters = "TRWAGMYFPDXBNJZSQVHLCKE";
  const remainder = Number(BigInt(digits) % 529n);
  return `ES${digits}${letters[Math.floor(remainder / 23)]}${letters[remainder % 23]}${suffix}`;
}

void test("normalización y controles de CUPS de 20 y 22 caracteres", () => {
  const digits = "0022000007748077";
  const cups20 = calculatedCups(digits);
  const cups22 = calculatedCups(digits, "1P");
  assert.equal(cups20.length, 20); assert.equal(cups22.length, 22);
  assert.deepEqual(validateCups(cups20), { cups: cups20, valid: true });
  assert.deepEqual(validateCups(cups22), { cups: cups22, valid: true });
  assert.equal(normalizeCups(`  ${cups22.slice(0, 9).toLowerCase()} ${cups22.slice(9).toLowerCase()}  `), cups22);
  assert.equal(validCups(`  ${cups22.slice(0, 9).toLowerCase()} ${cups22.slice(9).toLowerCase()}  `), cups22);
  assert.equal(cups20.slice(2, 4), "00");
  for (const invalid of [cups20.replace(/^ES/, "FR"), cups20.slice(0, -1), `ES${digits}1A`, `${cups20}AA`, `ES${digits.slice(0, -1)}XAA`]) {
    assert.equal(validateCups(invalid).valid, false);
    assert.equal((validateCups(invalid) as { code: string }).code, "CUPS_FORMATO_INVALIDO");
  }
  const wrongControls = `${cups20.slice(0, 18)}AA`;
  assert.equal((validateCups(wrongControls) as { code: string }).code, "CUPS_CONTROL_INVALIDO");
  assert.throws(() => validCups(wrongControls), (error: unknown) => (error as { getResponse: () => { code: string } }).getResponse().code === "CUPS_CONTROL_INVALIDO");
});

void test("CUPS inválido bloquea OAuth, CNMC y base de datos", async () => {
  let calls = 0;
  global.fetch = async () => { calls++; throw new Error("No debería solicitarse la CNMC"); };
  const prisma = { sipsConfig: { findUnique: async () => { calls++; return null; } } };
  const service = new SipsService(prisma as never, new AuthService());
  for (const cups of ["ES123", `${calculatedCups("0022000007748077").slice(0, 18)}AA`]) {
    await assert.rejects(() => service.consult(cups, "operaciones"));
  }
  assert.equal(calls, 0);
});

void test("sin datos, permisos, autenticación y error HTTP se distinguen", async () => {
  const cups = calculatedCups("0022000007748077");
  for (const [httpStatus, body, expected] of [
    [200, "No se han encontrado resultados", "NO_RESULTS"],
    [401, "unauthorized", "AUTH"],
    [403, "forbidden", "PERMISSION"],
    [503, "unavailable", "SERVICE"]
  ] as const) {
    const config: Record<string, unknown> = {};
    const queries: Array<Record<string, unknown>> = [];
    const prisma = {
      sipsConfig: { findUnique: async () => Object.keys(config).length ? config : null, upsert: async ({ create }: { create: object }) => { Object.assign(config, create); return config; } },
      sipsPs: { findUnique: async () => null },
      sipsConsumption: { findMany: async () => [] },
      sipsQuery: { create: async ({ data }: { data: object }) => { queries.push(data); }, findMany: async () => queries, updateMany: async () => ({ count: 0 }) }
    };
    const service = new SipsService(prisma as never, new AuthService());
    await service.saveConfig("operaciones", { environment: "production", consumerKey: "key", consumerSecret: "secret" });
    let tokenCalls = 0;
    global.fetch = async (input) => {
      if (String(input).endsWith("/oauth2/token")) { tokenCalls++; return new Response(JSON.stringify({ access_token: `token${tokenCalls}`, token_type: "Bearer", expires_in: 3600 }), { status: 200 }); }
      return new Response(body, { status: httpStatus });
    };
    const result = await service.consult(cups, "operaciones") as { results: { ps: { errorCode?: string }; consumption: { errorCode?: string } } };
    assert.equal(result.results.ps.errorCode, expected);
    assert.equal(result.results.consumption.errorCode, expected);
    assert.equal(queries.length, 2);
    assert.equal(tokenCalls, httpStatus === 401 ? 2 : 1);
  }
});

void test("OAuth compartido, 401 único y consulta parcial conservan datos", async () => {
  const cups = "ES0022000007748077EP1P";
  const config: Record<string, unknown> = {};
  const ps = new Map<string, Record<string, unknown>>();
  ps.set(cups, { normalized: { cups, codigoTarifaATREnVigor: "019" }, rawEncrypted: "previous", contentHash: "previous" });
  const consumption = new Map<string, Record<string, unknown>>();
  const queries: Array<Record<string, unknown>> = [];
  const prisma = {
    sipsConfig: { findUnique: async () => Object.keys(config).length ? config : null, upsert: async ({ create, update }: { create: object; update: object }) => { Object.assign(config, Object.keys(config).length ? update : create); return config; }, update: async ({ data }: { data: object }) => Object.assign(config, data) },
    sipsPs: { upsert: async ({ where, create, update }: { where: { cups: string }; create: object; update: object }) => { ps.set(where.cups, { ...(ps.get(where.cups) ?? {}), ...(ps.has(where.cups) ? update : create) }); }, findUnique: async ({ where }: { where: { cups: string } }) => ps.get(where.cups) ?? null, findMany: async () => [...ps.values()] },
    sipsConsumption: { upsert: async ({ where, create, update }: { where: { cups_dateFrom_dateTo: { cups: string; dateFrom: Date; dateTo: Date } }; create: object; update: object }) => { const key = `${where.cups_dateFrom_dateTo.cups}:${where.cups_dateFrom_dateTo.dateFrom.toISOString()}`; consumption.set(key, { ...(consumption.get(key) ?? {}), ...(consumption.has(key) ? update : create) }); }, findMany: async () => [...consumption.values()] },
    sipsQuery: { create: async ({ data }: { data: object }) => { queries.push({ ...data, queriedAt: new Date() }); }, findMany: async () => [...queries].reverse(), groupBy: async () => [{ cups, _max: { queriedAt: queries.at(-1)?.queriedAt } }], updateMany: async () => ({ count: 0 }) },
    $queryRaw: async () => [{ total: 1n }],
    $transaction: async (callback: (tx: unknown) => Promise<unknown>) => callback(prisma)
  };
  const service = new SipsService(prisma as never, new AuthService());
  await assert.rejects(() => service.saveConfig("operaciones", { environment: "production", consumerKey: "same", consumerSecret: "same" }), /diferentes/);
  await service.saveConfig("operaciones", { environment: "production", consumerKey: "key", consumerSecret: "secret" });
  let tokenCalls = 0; let psCalls = 0; let consumptionCalls = 0;
  global.fetch = async (input, init) => {
    const url = String(input);
    if (url.endsWith("/oauth2/token")) {
      assert.equal(init?.method, "POST");
      assert.equal((init?.headers as Record<string, string>).Authorization, `Basic ${Buffer.from("key:secret").toString("base64")}`);
      assert.equal(String(init?.body), "grant_type=client_credentials&scope=read");
      tokenCalls++; return new Response(JSON.stringify({ access_token: `token${tokenCalls}`, token_type: "Bearer", expires_in: 3600 }), { status: 200 });
    }
    if (url.includes("PS_ELECTRICIDAD")) { psCalls++; return new Response("unauthorized", { status: 401 }); }
    consumptionCalls++;
    const row = CONSUMPTION_HEADERS.map((key) => key === "cups" ? cups : key === "fechaInicioMesConsumo" ? "2026-01-01" : key === "fechaFinMesConsumo" ? "2026-01-31" : key.startsWith("consumoEnergiaActiva") ? "1000" : "");
    return new Response(`${CONSUMPTION_HEADERS.join(",")}\n${row.map((value) => `"${value}"`).join(",")}`, { status: 200 });
  };
  const result = await service.consult(cups, "operaciones") as { results: { ps: { status: string }; consumption: { status: string } } };
  assert.equal(result.results.ps.status, "ERROR"); assert.equal(result.results.consumption.status, "OK");
  assert.equal(tokenCalls, 2); assert.equal(consumptionCalls, 1);
  assert.equal(consumption.size, 1); assert.equal(queries.length, 2);
  assert.equal(ps.get(cups)?.contentHash, "previous");
  const history = await service.history();
  assert.equal(history.total, 1);
  assert.equal(history.items[0].psStatus, "ERROR");
  assert.equal(history.items[0].psErrorCode, "AUTH");
  assert.equal(history.items[0].consumptionStatus, "OK");
  const publicConfig = await service.config("operaciones");
  assert.equal(publicConfig.secretConfigured, true);
  assert.equal("consumerSecret" in publicConfig, false);
});

void test("historial SIPS limita cada página a 20 CUPS y conserva sus estados", async () => {
  const groups = Array.from({ length: 25 }, (_, index) => ({ cups: `ES${String(index).padStart(20, "0")}`, _max: { queriedAt: new Date(Date.UTC(2026, 0, 25 - index)) } }));
  const prisma = {
    $queryRaw: async () => [{ total: 25n }],
    sipsQuery: {
      groupBy: async ({ skip, take }: { skip: number; take: number }) => groups.slice(skip, skip + take),
      findMany: async ({ where }: { where: { cups: { in: string[] } } }) => where.cups.in.flatMap((cups) => [
        { cups, kind: "PS", status: "OK", errorCode: null },
        { cups, kind: "CONSUMPTION", status: "NO_RESULTS", errorCode: "NO_RESULTS" }
      ])
    },
    sipsPs: { findMany: async ({ where }: { where: { cups: { in: string[] } } }) => where.cups.in.map((cups) => ({ cups, distributor: "Distribuidora", tariff: "019" })) }
  };
  const service = new SipsService(prisma as never, new AuthService());
  const first = await service.history("1");
  assert.equal(first.total, 25); assert.equal(first.pageSize, 20); assert.equal(first.items.length, 20);
  assert.equal(first.items[0].cups, groups[0].cups); assert.equal(first.items[0].psStatus, "OK");
  assert.equal(first.items[0].consumptionStatus, "NO_RESULTS");
  const second = await service.history("2");
  assert.equal(second.items.length, 5); assert.equal(second.items[0].cups, groups[20].cups);
  assert.equal((await service.history("3")).page, 2);
  await assert.rejects(() => service.history("0"), /Página de historial no válida/);
});
