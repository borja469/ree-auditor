import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";

export type PricingCalculatorManualValueDto = {
  concepto: string;
  tarifa: string;
  periodo: string;
  valor: number | null;
  updatedAt: string;
};

@Injectable()
export class PricingCalculatorManualValuesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(): Promise<PricingCalculatorManualValueDto[]> {
    const rows = await this.prisma.pricingCalculatorManualValue.findMany({
      orderBy: [{ tarifa: "asc" }, { periodo: "asc" }, { concepto: "asc" }]
    });
    return rows.map((row) => ({
      concepto: row.concepto,
      tarifa: row.tarifa,
      periodo: row.periodo,
      valor: decimalToNullableNumber(row.valor),
      updatedAt: row.updatedAt.toISOString()
    }));
  }

  async save(input: { concepto: string; tarifa: string; periodo: string; valor: number | null }): Promise<PricingCalculatorManualValueDto> {
    if (input.valor === null) {
      await this.prisma.pricingCalculatorManualValue
        .delete({
          where: {
            concepto_tarifa_periodo: {
              concepto: input.concepto,
              tarifa: input.tarifa,
              periodo: input.periodo
            }
          }
        })
        .catch(() => null);
      return { ...input, updatedAt: new Date().toISOString() };
    }

    const row = await this.prisma.pricingCalculatorManualValue.upsert({
      where: {
        concepto_tarifa_periodo: {
          concepto: input.concepto,
          tarifa: input.tarifa,
          periodo: input.periodo
        }
      },
      create: {
        concepto: input.concepto,
        tarifa: input.tarifa,
        periodo: input.periodo,
        valor: new Prisma.Decimal(input.valor.toFixed(8))
      },
      update: {
        valor: new Prisma.Decimal(input.valor.toFixed(8))
      }
    });

    return {
      concepto: row.concepto,
      tarifa: row.tarifa,
      periodo: row.periodo,
      valor: decimalToNullableNumber(row.valor),
      updatedAt: row.updatedAt.toISOString()
    };
  }
}

function decimalToNullableNumber(value: Prisma.Decimal | null | undefined) {
  return value === null || value === undefined ? null : Number(value);
}
