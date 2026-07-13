import { Injectable } from "@nestjs/common";
import type { PricingBaseRow } from "./pricing-base.types";

@Injectable()
export class PricingBaseExportService {
  toCsv(rows: PricingBaseRow[]) {
    const headers = pricingBaseHeaders();
    return [headers.join(";"), ...rows.map((row) => headers.map((header) => csvCell(row[header as keyof PricingBaseRow])).join(";"))].join("\n");
  }

  toExcelHtml(rows: PricingBaseRow[]) {
    const headers = pricingBaseHeaders();
    const headerCells = headers.map((header) => `<th>${escapeHtml(header)}</th>`).join("");
    const body = rows.map((row) => `<tr>${headers.map((header) => `<td>${escapeHtml(String(row[header as keyof PricingBaseRow] ?? ""))}</td>`).join("")}</tr>`).join("");
    return `<table><thead><tr>${headerCells}</tr></thead><tbody>${body}</tbody></table>`;
  }
}

function pricingBaseHeaders() {
  return [
    "fecha",
    "ano",
    "mes",
    "dia",
    "diaSemana",
    "diaSemanaNombre",
    "hora",
    "timestampInicio",
    "timestampFin",
    "cambioHorarioDst",
    "ordenDia365",
    "ordenHora",
    "perfilIntermedio20TD",
    "perfilIntermedio30TD",
    "perfilIntermedio30TDVE",
    "productoPerfilOmie20TD",
    "productoPerfilOmie30TD",
    "productoPerfilOmie30TDVE",
    "productoPerfilCad20TD",
    "productoPerfilCad30TD",
    "productoPerfilCad30TDVE",
    "productoPerfilRad20TD",
    "productoPerfilRad30TD",
    "productoPerfilRad30TDVE",
    "productoPerfilPerdidas20TD",
    "productoPerfilPerdidas30TD",
    "productoPerfilPerdidas30TDVE",
    "periodo20TD",
    "periodo30TD",
    "periodo6XTD",
    "precioOmie",
    "precioOmieUnidad",
    "cad",
    "cadVersion",
    "cadStatus",
    "rad",
    "radVersion",
    "radStatus",
    "perdidas",
    "perdidasVersion",
    "perdidasStatus",
    "perfil20TDStatus",
    "perfil30TDStatus",
    "perfil30TDVEStatus",
    "omieStatus"
  ];
}

function csvCell(value: unknown) {
  return `"${String(value ?? "").replace(/"/g, "\"\"")}"`;
}

function escapeHtml(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
