# Pricing base para apuntamientos

Primera fase del modulo de pricing. No calcula importes economicos finales: solo construye y visualiza la tabla base horaria con calendario, perfiles intermedios, periodos tarifarios y precio OMIE.

## Entrada

Endpoint principal:

`GET /pricing-base/table`

Parametros:

- `fechaReferencia`: fecha `YYYY-MM-DD`.
- `incluirFechaReferencia`: `true` o `false`.
- `skip` / `take`: paginacion.

La zona horaria es fija: `Europe/Madrid`.

## Fuentes de datos esperadas

- Perfiles intermedios: tabla Prisma `esios_profile_intermediate_results`, tarifas `2.0TD`, `3.0TD`, `3.0TDVE`. La tabla base no conserva el perfil horario bruto: cada columna `perfil_intermedio_*` contiene el peso mensual normalizado `perfil_horario / suma_perfiles_del_mes` del mismo perfil y mes natural.
- Precio OMIE mercado diario: tabla Prisma `omie_prices`, `tipoPrecio = MD`, en periodos cuartohorarios. Se agrega a horario por promedio simple. Con 4 valores el estado es `ok`, con 3 es `partial`, con menos de 3 queda `missing`.
- CAD: tabla Prisma `reganecu_records`, codigos `CAD`/`P_CAD` o apuntes CAD. Usa `precio_eur_mwh` horario y selecciona automaticamente la version mas reciente disponible por fecha/hora (`C5 > C4 > C3 > C2 > C1`).
- RAD: tabla Prisma `reganecu_qh_records`, codigos `RAD3`/`P_RAD3`/`P_2RAD3` o apuntes RAD3. Usa `precio_eur_mwh`, selecciona la version mas reciente disponible por fecha/hora y agrega de cuartohorario a horario con la utilidad comun `quarter_hour_to_hourly_average`.
- Perdidas: tablas Prisma `ree_k_factor` y `perdidas_boe`. Usa el factor K aplicable por fecha/hora/tarifa/periodo y lo multiplica por el porcentaje BOE vigente para obtener la perdida final; selecciona version `C5 > C4 > C3 > C2 > C1` y agrega cuartohorario a horario con la misma regla `ok/partial/missing`. La vista usa `2.0TD` como tarifa base para la columna `perdidas`.
- Festivos nacionales: calendario nacional calculado en codigo para festivos fijos estatales y Viernes Santo. Si se requiere calendario oficial actualizado por BOE, debe sustituirse por una fuente externa validada en la siguiente fase.

## Salida

La respuesta contiene:

- `range`: rango de 365 dias naturales y numero esperado de horas reales en `Europe/Madrid`.
- `rows`: tabla horaria con calendario, perfiles intermedios normalizados, productos perfil x OMIE/CAD/RAD/perdidas, periodos tarifarios, OMIE, CAD, RAD y perdidas.
- `validations`: validaciones automaticas de rango, horas, duplicados, nulos criticos, periodos y alineacion de fuentes.
- `sourceData`: fuentes usadas.

Columnas calculadas:

- `productoPerfilOmie20TD` = `perfilIntermedio20TD * precioOmie`
- `productoPerfilOmie30TD` = `perfilIntermedio30TD * precioOmie`
- `productoPerfilOmie30TDVE` = `perfilIntermedio30TDVE * precioOmie`
- `productoPerfilCad20TD` = `perfilIntermedio20TD * cad`
- `productoPerfilCad30TD` = `perfilIntermedio30TD * cad`
- `productoPerfilCad30TDVE` = `perfilIntermedio30TDVE * cad`
- `productoPerfilRad20TD` = `perfilIntermedio20TD * rad`
- `productoPerfilRad30TD` = `perfilIntermedio30TD * rad`
- `productoPerfilRad30TDVE` = `perfilIntermedio30TDVE * rad`
- `productoPerfilPerdidas20TD` = `perfilIntermedio20TD * perdidas`
- `productoPerfilPerdidas30TD` = `perfilIntermedio30TD * perdidas`
- `productoPerfilPerdidas30TDVE` = `perfilIntermedio30TDVE * perdidas`

Si el perfil o el precio/coste correspondiente faltan, el producto queda `null`.

Exportaciones backend:

- `GET /pricing-base/export.csv`
- `GET /pricing-base/export.xls`

La pantalla esta en `Pricing > Tabla base` y permite consultar por fecha de referencia, filtrar/ordenar en tabla y exportar con el componente de tabla tecnico.

## Fuera de alcance

No se implementa todavia el calculo economico de apuntamientos, liquidacion o importes finales.
