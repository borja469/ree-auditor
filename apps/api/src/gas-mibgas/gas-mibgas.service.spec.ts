const assert = require("node:assert/strict");
const { describe, it } = require("node:test");
const { Prisma } = require("@prisma/client");
const { GasMibgasService } = require("./gas-mibgas.service");
const { MibgasDownloader } = require("./mibgas-downloader");
const { MibgasParser, validateMibgasNaturalKey } = require("./mibgas-parser");

const CSV = [
  "Fecha Emisión :10/09/2026 - 09:33;",
  "Trading day;Product;Place of delivery;Area;First Day Delivery;Last Day Delivery;MIBGAS Daily Price [EUR/MWh];",
  "09/09/2026;GDAES_D+1;PVB;ES;10/09/2026;10/09/2026;80.77;",
  "09/09/2026;GMAES;PVB;ES;01/10/2026;31/10/2026;;",
  "09/09/2026;GQES_Q+1;VTP;PT;01/10/2026;31/12/2026;70,12;"
].join("\n");

void describe("MIBGAS parser", () => {
  void it("ignora metadata, parsea fechas dd/mm/yyyy, precio decimal y precio vacio como null", () => {
    const parsed = new MibgasParser().parse(Buffer.from(CSV, "utf8"), { year: 2026, filename: "MIBGAS_Data_2026.csv" });

    assert.equal(parsed.rows.length, 3);
    assert.equal(parsed.sourceEmissionDatetime.toISOString(), "2026-09-10T07:33:00.000Z");
    assert.equal(parsed.rows[0].tradingDay.toISOString().slice(0, 10), "2026-09-09");
    assert.equal(parsed.rows[0].priceEurMwh, "80.77");
    assert.equal(parsed.rows[1].priceEurMwh, null);
    assert.equal(parsed.rows[2].placeOfDelivery, "VTP");
    assert.equal(parsed.rows[2].area, "PT");
    assert.equal(parsed.rows[2].priceEurMwh, "70.12");
  });

  void it("rechaza ficheros vacios y HTML recibido como CSV", () => {
    assert.throws(() => new MibgasParser().parse(Buffer.from(""), { year: 2026, filename: "empty.csv" }), /vacio/);
    assert.throws(() => new MibgasParser().parse(Buffer.from("<html>Error</html>"), { year: 2026, filename: "error.csv" }), /HTML/);
  });

  void it("rechaza cabeceras desconocidas", () => {
    assert.throws(
      () => new MibgasParser().parse(Buffer.from("Fecha Emisión :10/09/2026 - 09:33;\nTrading day;Product;\n"), { year: 2026, filename: "bad.csv" }),
      /Faltan columnas obligatorias/
    );
  });

  void it("rechaza fechas imposibles sin aplicar rollover de JavaScript", () => {
    const csv = [
      "Fecha EmisiÃ³n :10/09/2026 - 09:33;",
      "Trading day;Product;Place of delivery;Area;First Day Delivery;Last Day Delivery;MIBGAS Daily Price [EUR/MWh];",
      "09/09/2026;GDAES_D+1;PVB;ES;10/09/2026;10/09/2026;80.77;",
      "31/02/2026;GDAES_D+1;PVB;ES;10/09/2026;10/09/2026;80.77;"
    ].join("\n");
    const parsed = new MibgasParser().parse(Buffer.from(csv), { year: 2026, filename: "MIBGAS_Data_2026.csv" });

    assert.equal(parsed.rows.length, 1);
    assert.equal(parsed.errors.length, 1);
    assert.match(parsed.errors[0].message, /fecha valida/);
  });

  void it("detecta duplicados para la clave natural propuesta", () => {
    const parsed = new MibgasParser().parse(Buffer.from(`${CSV}\n09/09/2026;GDAES_D+1;PVB;ES;10/09/2026;10/09/2026;80.77;`), {
      year: 2026,
      filename: "MIBGAS_Data_2026.csv"
    });

    assert.equal(validateMibgasNaturalKey(parsed.rows).duplicateRows, 1);
  });
});

void describe("MIBGAS downloader", () => {
  void it("usa primero la URL directa oficial corregida", async () => {
    const calls = [];
    const downloader = new MibgasDownloader();
    downloader.setFetchForTests(async (url) => {
      calls.push(String(url));
      return response(CSV, { contentType: "application/octet-stream" });
    });

    const result = await downloader.downloadYear(2026);

    assert.equal(result.url, "https://www.mibgas.es/es/file-access/MIBGAS_Data_2026.csv?path=AGNO_2026%2FXLS");
    assert.equal(calls.length, 1);
  });

  void it("resuelve el enlace desde la carpeta si la descarga directa falla", async () => {
    const calls = [];
    const downloader = new MibgasDownloader();
    downloader.setFetchForTests(async (url) => {
      calls.push(String(url));
      if (calls.length === 1) {
        return response("No encontrado", { status: 404 });
      }
      if (calls.length === 2) {
        return response('<a href="/es/file-access/MIBGAS_Data_2026.csv?path=AGNO_2026%2FXLS">MIBGAS_Data_2026.csv</a>', { contentType: "text/html" });
      }
      return response(CSV, { contentType: "text/csv" });
    });

    const result = await downloader.downloadYear(2026);

    assert.equal(calls.length, 3);
    assert.equal(result.filename, "MIBGAS_Data_2026.csv");
  });
});

void describe("GasMibgasService", () => {
  void it("sincroniza de forma idempotente y cuenta unchanged", async () => {
    const prisma = new FakePrisma();
    const service = new GasMibgasService(prisma, downloaderWith(CSV));

    const first = await service.syncYear(2026, "MANUAL");
    const second = await service.syncYear(2026, "MANUAL");

    assert.equal(first.inserted, 3);
    assert.equal(first.updated, 0);
    assert.equal(first.unchanged, 0);
    assert.equal(second.inserted, 0);
    assert.equal(second.updated, 0);
    assert.equal(second.unchanged, 3);
    assert.equal(prisma.prices.length, 3);
  });

  void it("actualiza NULL a precio y precio modificado sin duplicar", async () => {
    const prisma = new FakePrisma();
    const service = new GasMibgasService(prisma, downloaderWith(CSV));
    await service.syncYear(2026, "MANUAL");

    const nextCsv = CSV.replace("09/09/2026;GMAES;PVB;ES;01/10/2026;31/10/2026;;", "09/09/2026;GMAES;PVB;ES;01/10/2026;31/10/2026;81.12;")
      .replace("09/09/2026;GDAES_D+1;PVB;ES;10/09/2026;10/09/2026;80.77;", "09/09/2026;GDAES_D+1;PVB;ES;10/09/2026;10/09/2026;80.99;");
    service.downloader = downloaderWith(nextCsv);

    const result = await service.syncYear(2026, "MANUAL");

    assert.equal(result.inserted, 0);
    assert.equal(result.updated, 2);
    assert.equal(result.unchanged, 1);
    assert.equal(prisma.prices.length, 3);
  });

  void it("no modifica precios si el fichero descargado no valida", async () => {
    const prisma = new FakePrisma();
    const service = new GasMibgasService(prisma, downloaderWith(CSV));
    await service.syncYear(2026, "MANUAL");
    service.downloader = downloaderWith("<html>Mantenimiento</html>");

    const result = await service.syncYear(2026, "MANUAL");

    assert.equal(result.status, "ERROR");
    assert.equal(prisma.prices.length, 3);
  });

  void it("registra filas invalidas sin persistir precios", async () => {
    const prisma = new FakePrisma();
    const invalidCsv = [
      "Fecha Emisión :10/09/2026 - 09:33;",
      "Trading day;Product;Place of delivery;Area;First Day Delivery;Last Day Delivery;MIBGAS Daily Price [EUR/MWh];",
      "09/09/2026;GDAES_D+1;PVB;ES;10/09/2026;10/09/2026;80.77;",
      "09/09/2026;;PVB;ES;10/09/2026;10/09/2026;80.77;"
    ].join("\n");
    const service = new GasMibgasService(prisma, downloaderWith(invalidCsv));

    const result = await service.syncYear(2026, "MANUAL");

    assert.equal(result.status, "ERROR");
    assert.equal(result.errors.length, 1);
    assert.equal(prisma.syncRuns.at(-1).errorRows, 1);
    assert.equal(prisma.prices.length, 0);
  });

  void it("continua la sincronizacion historica cuando un ano no existe", async () => {
    const prisma = new FakePrisma();
    const downloader = {
      downloadYear: async (year) => {
        if (year === 2025) {
          throw new Error("No existe");
        }
        return { year, url: `url-${year}`, filename: `MIBGAS_Data_${year}.csv`, content: Buffer.from(CSV), contentType: "text/csv", contentLength: CSV.length };
      }
    };
    const service = new GasMibgasService(prisma, downloader);

    const result = await service.syncHistory(2025, 2026);

    assert.equal(result.success, 1);
    assert.equal(result.errors, 1);
  });
});

function downloaderWith(content) {
  return {
    downloadYear: async (year) => ({
      year,
      url: `https://www.mibgas.es/es/file-access/MIBGAS_Data_${year}.csv?path=AGNO_${year}%2FXLS`,
      filename: `MIBGAS_Data_${year}.csv`,
      content: Buffer.from(content, "utf8"),
      contentType: "text/csv",
      contentLength: Buffer.byteLength(content)
    })
  };
}

function response(body, options = {}) {
  const status = options.status ?? 200;
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get: (name) => (name.toLowerCase() === "content-type" ? options.contentType ?? "text/plain" : null)
    },
    text: async () => body,
    arrayBuffer: async () => Buffer.from(body, "utf8")
  };
}

class FakePrisma {
  constructor() {
    this.prices = [];
    this.syncRuns = [];
    this.nextId = 1;
    this.gasMibgasPrice = {
      count: async () => this.prices.length,
      findMany: async () => this.prices,
      findFirst: async (args) => this.prices.find((row) => matchesWhere(row, args.where)) ?? null,
      create: async (args) => {
        const row = { id: `price-${this.nextId++}`, updatedAt: new Date(), ...args.data };
        this.prices.push(row);
        return row;
      },
      update: async (args) => {
        const row = this.prices.find((item) => item.id === args.where.id);
        Object.assign(row, args.data, { updatedAt: new Date() });
        return row;
      }
    };
    this.gasMibgasSyncRun = {
      create: async (args) => {
        const row = {
          id: `run-${this.nextId++}`,
          finishedAt: null,
          url: null,
          sourceFilename: null,
          sourceEmissionDatetime: null,
          rowsRead: 0,
          insertedRows: 0,
          updatedRows: 0,
          unchangedRows: 0,
          nullPriceRows: 0,
          errorRows: 0,
          errorMessage: null,
          ...args.data
        };
        this.syncRuns.push(row);
        return row;
      },
      update: async (args) => {
        const row = this.syncRuns.find((item) => item.id === args.where.id);
        Object.assign(row, args.data);
        return row;
      },
      findFirst: async () => this.syncRuns.at(-1) ?? null,
      count: async () => this.syncRuns.length,
      findMany: async () => this.syncRuns
    };
    this.gasMibgasAutomationConfig = {
      upsert: async (args) => ({ id: 1, active: false, scheduleTime: "22:30", syncCurrentYear: true, lastRunKey: null, lastRunAt: null, ...args.create }),
      update: async (args) => ({ id: 1, active: false, scheduleTime: "22:30", syncCurrentYear: true, lastRunKey: null, lastRunAt: null, ...args.data })
    };
  }

  async $transaction(callback) {
    return callback(this);
  }
}

function matchesWhere(row, where) {
  return (
    sameDate(row.tradingDay, where.tradingDay) &&
    row.product === where.product &&
    row.placeOfDelivery === where.placeOfDelivery &&
    row.area === where.area &&
    sameDate(row.firstDayDelivery, where.firstDayDelivery) &&
    sameDate(row.lastDayDelivery, where.lastDayDelivery)
  );
}

function sameDate(left, right) {
  return left instanceof Date && right instanceof Date && left.toISOString().slice(0, 10) === right.toISOString().slice(0, 10);
}
