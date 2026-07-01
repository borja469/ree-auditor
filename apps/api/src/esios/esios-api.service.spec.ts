import { Prisma } from "@prisma/client";
import { EsiosApiService } from "./esios-api.service";

describe("EsiosApiService", () => {
  it("crea los indicadores ESIOS por defecto", async () => {
    const prisma = mockPrisma();
    const service = new EsiosApiService(prisma as never);

    await service.ensureDefaults();

    expect(prisma.esiosIndicator.upsert).toHaveBeenCalledTimes(4);
    expect(prisma.esiosIndicator.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { indicatorId: 460 },
        create: expect.objectContaining({ indicatorId: 460, name: "Demanda prevista peninsular", active: true }),
        update: expect.objectContaining({ active: true, name: "Demanda prevista peninsular" })
      })
    );
    expect(prisma.esiosIndicator.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { indicatorId: 541 },
        create: expect.objectContaining({ indicatorId: 541, name: "Previsión eólica", active: true })
      })
    );
  });

  it("clasifica token invalido en testConnection", async () => {
    const service = new EsiosApiService(mockPrisma({ apiToken: "bad-token" }) as never);
    const originalFetch = global.fetch;
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: () => Promise.resolve(JSON.stringify({ message: "Unauthorized" }))
    } as Response);

    await expect(service.testConnection()).resolves.toMatchObject({
      status: "invalid_token"
    });
    global.fetch = originalFetch;
  });

  it("guarda valores insertados y actualizados con upsert", async () => {
    const prisma = mockPrisma({ existingDatetime: new Date("2026-01-01T01:00:00.000Z"), existingDatetimeUtc: new Date("2026-01-01T00:00:00.000Z") });
    const service = new EsiosApiService(prisma as never);
    const result = await service.saveIndicatorValues([
      {
        indicatorId: 460,
        datetime: new Date("2026-01-01T00:00:00.000Z"),
        datetimeUtc: new Date("2025-12-31T23:00:00.000Z"),
        value: new Prisma.Decimal("20000.000000"),
        geoId: 3,
        geoName: "Peninsula"
      },
      {
        indicatorId: 460,
        datetime: new Date("2026-01-01T01:00:00.000Z"),
        datetimeUtc: new Date("2026-01-01T00:00:00.000Z"),
        value: new Prisma.Decimal("20100.000000"),
        geoId: 3,
        geoName: "Peninsula"
      }
    ]);

    expect(result).toEqual({ insertedRecords: 1, updatedRecords: 1 });
    expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
  });

  it("permite dos horas locales iguales en el cambio horario si datetimeUtc es distinto", async () => {
    const prisma = mockPrisma();
    const service = new EsiosApiService(prisma as never);

    const result = await service.saveIndicatorValues([
      {
        indicatorId: 460,
        datetime: new Date("2026-10-25T02:00:00.000Z"),
        datetimeUtc: new Date("2026-10-25T00:00:00.000Z"),
        value: new Prisma.Decimal("21000.000000"),
        geoId: 3,
        geoName: "Peninsula"
      },
      {
        indicatorId: 460,
        datetime: new Date("2026-10-25T02:00:00.000Z"),
        datetimeUtc: new Date("2026-10-25T01:00:00.000Z"),
        value: new Prisma.Decimal("21100.000000"),
        geoId: 3,
        geoName: "Peninsula"
      }
    ]);

    expect(result).toEqual({ insertedRecords: 2, updatedRecords: 0 });
    expect(prisma.esiosIndicatorValue.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          OR: [
            { indicatorId: 460, datetimeUtc: new Date("2026-10-25T00:00:00.000Z") },
            { indicatorId: 460, datetimeUtc: new Date("2026-10-25T01:00:00.000Z") }
          ]
        }
      })
    );
  });

  it("deduplica valores repetidos dentro del mismo lote antes del upsert", async () => {
    const prisma = mockPrisma();
    const service = new EsiosApiService(prisma as never);

    const repeatedInstant = new Date("2026-10-25T00:00:00.000Z");
    const result = await service.saveIndicatorValues([
      {
        indicatorId: 460,
        datetime: new Date("2026-10-25T02:00:00.000Z"),
        datetimeUtc: repeatedInstant,
        value: new Prisma.Decimal("21000.000000"),
        geoId: 3,
        geoName: "Peninsula"
      },
      {
        indicatorId: 460,
        datetime: new Date("2026-10-25T02:00:00.000Z"),
        datetimeUtc: repeatedInstant,
        value: new Prisma.Decimal("21050.000000"),
        geoId: 3,
        geoName: "Peninsula"
      }
    ]);

    expect(result).toEqual({ insertedRecords: 1, updatedRecords: 0 });
    expect(prisma.esiosIndicatorValue.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          OR: [{ indicatorId: 460, datetimeUtc: repeatedInstant }]
        }
      })
    );
    expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
  });
});

function mockPrisma(options: { apiToken?: string; existingDatetime?: Date; existingDatetimeUtc?: Date } = {}) {
  return {
    esiosConfig: {
      findUnique: jest.fn().mockResolvedValue({
        id: 1,
        apiUrl: "https://api.esios.ree.es",
        apiToken: options.apiToken ?? "token",
        timeoutSeconds: 1,
        retries: 0,
        active: true
        }),
      create: jest.fn()
    },
    esiosIndicator: {
      upsert: jest.fn().mockResolvedValue(undefined)
    },
    esiosIndicatorValue: {
      findMany: jest.fn().mockResolvedValue(
        options.existingDatetime
          ? [
              {
                indicatorId: 460,
                datetime: options.existingDatetime,
                datetimeUtc: options.existingDatetimeUtc ?? null
              }
            ]
          : []
      )
    },
    esiosDownloadLog: {
      findFirst: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
      create: jest.fn().mockResolvedValue(undefined)
    },
    $executeRaw: jest.fn().mockResolvedValue(2)
  };
}
