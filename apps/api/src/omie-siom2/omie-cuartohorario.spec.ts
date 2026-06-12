import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { identificarConsultasCuartohorarias } from "./omie-cuartohorario.ts";
import type { OmieConsultasCatalogo } from "./omie-siom2.types.ts";

void describe("identificarConsultasCuartohorarias", () => {
  void it("detects 96 quarter-hour price columns", () => {
    const candidatas = identificarConsultasCuartohorarias(
      buildCatalogo([
        {
          codigo: "4118",
          descripcion: "Precios por periodo en cada ronda",
          categoria: "Mercado continuo. Resultados",
          parametros: [
            parametro("Fec", "Fecha", "Fecha"),
            parametro("Txt", "Zona", "Zona")
          ],
          columnas: [
            columna("Num", "Ronda", "Ronda"),
            ...quarterHourColumns("periodo")
          ]
        }
      ])
    );

    assert.equal(candidatas.length, 1);
    assert.equal(candidatas[0].codigo, "4118");
    assert.equal(candidatas[0].numeroColumnas, 97);
  });

  void it("detects a 96-period parameter only when the parameter is a period selector", () => {
    const candidatas = identificarConsultasCuartohorarias(
      buildCatalogo([
        {
          codigo: "4120",
          descripcion: "Transacciones por contrato del agente",
          categoria: "Mercado continuo. Resultados",
          parametros: [parametro("Txt", "Hora", "Periodo de entrega", ["1", "96"])],
          columnas: [columna("Num", "Precio", "Precio")]
        },
        {
          codigo: "5396",
          descripcion: "Facturaciones relativas a retribucion de OMIE",
          categoria: "Liquidaciones. Descarga de Ficheros",
          parametros: [parametro("Txt", "agente", "Agente", ["1", "96"])],
          columnas: [columna("Txt", "Factura", "Factura")]
        }
      ])
    );

    assert.deepEqual(
      candidatas.map((consulta) => consulta.codigo),
      ["4120"]
    );
  });
});

function buildCatalogo(consultas: Array<Partial<OmieConsultasCatalogo["consultas"][number]> & { codigo: string }>): OmieConsultasCatalogo {
  return {
    generatedAt: "2026-06-02T00:00:00.000Z",
    catalogPath: "data/omie-catalogo.json",
    source: {
      directorio: {
        serviceName: "ServicioConsultaDirectorioConsultas",
        statusCode: 200,
        xmlBytes: 0
      },
      configuracionesConsultadas: consultas.length,
      configuracionesConError: 0
    },
    resumen: {
      totalConsultas: consultas.length,
      totalCategorias: 1,
      categorias: [],
      consultasPorCategoria: {},
      consultasPorTipo: {},
      topCategorias: []
    },
    consultas: consultas.map((consulta) => ({
      descripcion: consulta.descripcion,
      categoria: consulta.categoria,
      version: consulta.version,
      tipoConsulta: consulta.tipoConsulta,
      parametros: consulta.parametros ?? [],
      columnas: consulta.columnas ?? [],
      configuracion: {
        serviceName: "ServicioConsultaConfiguracionConsulta",
        statusCode: 200,
        xmlBytes: 0
      },
      codigo: consulta.codigo
    }))
  };
}

function parametro(tipo: string, nombre: string, descripcion: string, selecciones: string[] = []) {
  return {
    tipo,
    nombre,
    descripcion,
    selecciones: selecciones.map((seleccion) => ({
      codigo: seleccion,
      descripcion: seleccion,
      atributos: {
        cod: seleccion,
        desc: seleccion
      }
    })),
    atributos: {
      n: nombre,
      desc: descripcion
    }
  };
}

function columna(tipo: string, nombre: string, descripcion: string) {
  return {
    tipo,
    nombre,
    descripcion,
    atributos: {
      n: nombre,
      desc: descripcion
    }
  };
}

function quarterHourColumns(prefix: string) {
  return Array.from({ length: 24 }, (_, hour) =>
    Array.from({ length: 4 }, (_unused, quarter) => {
      const name = `${prefix}H${String(hour + 1).padStart(2, "0")}Q${quarter + 1}`;
      return columna("Num", name, name);
    })
  ).flat();
}
