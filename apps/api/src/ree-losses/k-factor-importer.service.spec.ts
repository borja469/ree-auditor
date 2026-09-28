import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { kFactorIdentityKey, kFactorPublicationRevision } from "./k-factor-importer.service";

void describe("REE K factor idempotency key", () => {
  const base = {
    fecha: new Date("2024-10-01T00:00:00.000Z"),
    hora: 1,
    cuartohora: 1,
    tipoArchivo: "KESTIMQH",
    tarifa: "2.0TD",
    periodo: "P1"
  };

  void it("allows A1 and C1 for the same period", () => {
    assert.notEqual(kFactorIdentityKey({ ...base, version: "A1" }), kFactorIdentityKey({ ...base, version: "C1" }));
  });

  void it("allows C1 and A2 for the same period", () => {
    assert.notEqual(kFactorIdentityKey({ ...base, version: "C1" }), kFactorIdentityKey({ ...base, version: "A2" }));
  });

  void it("allows A2 and C2 for the same period", () => {
    assert.notEqual(kFactorIdentityKey({ ...base, version: "A2" }), kFactorIdentityKey({ ...base, version: "C2" }));
  });

  void it("returns the same key for the same functional record", () => {
    assert.equal(kFactorIdentityKey({ ...base, version: "A1" }), kFactorIdentityKey({ ...base, version: "A1" }));
  });

  void it("distinguishes KESTIMQH and KREALQH", () => {
    assert.notEqual(
      kFactorIdentityKey({ ...base, version: "A1", tipoArchivo: "KESTIMQH" }),
      kFactorIdentityKey({ ...base, version: "A1", tipoArchivo: "KREALQH" })
    );
  });

  void it("allows different tariff for the same settlement and quarter hour", () => {
    assert.notEqual(
      kFactorIdentityKey({ ...base, version: "A1", tarifa: "2.0TD" }),
      kFactorIdentityKey({ ...base, version: "A1", tarifa: "3.0TD" })
    );
  });

  void it("allows different tariff period for the same settlement and quarter hour", () => {
    assert.notEqual(
      kFactorIdentityKey({ ...base, version: "A1", periodo: "P1" }),
      kFactorIdentityKey({ ...base, version: "A1", periodo: "P2" })
    );
  });

  void it("treats same key with different K value as the same functional row", () => {
    const left = { ...base, version: "A1", valorK: 1.1 };
    const right = { ...base, version: "A1", valorK: 1.2 };
    assert.equal(kFactorIdentityKey(left), kFactorIdentityKey(right));
  });
});

void describe("REE K factor publication revision", () => {
  void it("reads ServicioLQ ZIP publication suffixes", () => {
    assert.equal(kFactorPublicationRevision("REE_ESIOS_A1_liquicomun_202610.1.zip"), 1);
    assert.equal(kFactorPublicationRevision("REE_ESIOS_A1_liquicomun_202610.24.zip"), 24);
  });

  void it("does not infer a publication revision from source file names", () => {
    assert.equal(kFactorPublicationRevision("A1_Kestimqh_20261001_20261031"), null);
    assert.equal(kFactorPublicationRevision(undefined), null);
  });
});
