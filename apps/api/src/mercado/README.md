# Mercado indicator mapping

## Objetivo

`MercadoIndicatorMappingService` resuelve automaticamente que indicador ESIOS alimenta cada variable base del modulo Mercado. No usa IDs hardcodeados ni requiere un fichero JSON externo.

El precio OMIE se marca como `external` porque procede de `OmiePrice`.

## Flujo

1. Lee el catalogo activo de `EsiosIndicator`.
2. Normaliza `name`, `shortName`, `description`, `unit` y `frequency`.
3. Clasifica cada indicador por categoria funcional electrica.
4. Preselecciona candidatos por categoria funcional y reglas semanticas de cada variable.
5. Consulta geografias solo para esos candidatos en `EsiosIndicatorValue`.
6. Calcula un ranking de confianza.
7. Aplica confirmaciones manuales si existen en `MercadoIndicatorMappingConfirmation`.
8. Devuelve mapping, alternativas, categoria, desglose del score y explicacion de ambiguedad.

## Estados

- `external`: variable fuera de ESIOS, por ejemplo `precioOmie`.
- `auto`: candidato seleccionado automaticamente.
- `ambiguous`: candidato principal razonable, pero con alternativas cercanas.
- `confirmed`: decision persistida por el usuario.
- `not_found`: sin candidato usable.

## Scoring

Antes del scoring se aplica un filtro de dominio electrico. Por ejemplo:

- `demandaPrevista` solo compite contra indicadores de demanda.
- `eolica` solo compite contra indicadores de prevision.
- `fotovoltaica`, `termosolar`, `nuclear`, `hidraulicaUGH`, `hidraulicaNoUGH` y `bombeo` compiten contra generacion programada PBF.
- `intercambios` compite contra generacion en tiempo real de intercambios, no contra capacidad NTC/ATC.

Las categorias funcionales evitan que indicadores de potencia instalada, P48, PHF, PVP o capacidad de intercambio compitan por similitud textual con indicadores operativos.

Despues del filtro funcional, la confianza se calcula con:

- coincidencias obligatorias por grupos de terminos;
- categoria funcional esperada;
- terminos preferidos;
- terminos fuertemente preferidos;
- penalizaciones por terminos no deseados, por ejemplo `potencia instalada`, `tiempo real`, `PHF`, `P48`;
- unidad y frecuencia;
- evidencia de datos disponibles;
- geografia esperada, normalmente Peninsula/Espana.

El endpoint devuelve `scoreBreakdown` con las aportaciones de cada bloque y `ambiguityReason` cuando el sistema no puede confirmar automaticamente.

Las reglas viven en `VARIABLE_RULES`. No contienen IDs, solo semantica de catalogo.

## Cache e invalidacion

El servicio mantiene una cache en memoria durante 5 minutos.

La cache:

- evita recalcular rankings en cada peticion;
- deduplica llamadas concurrentes mediante una promesa `inFlight`;
- se invalida al confirmar un mapping;
- puede invalidarse explicitamente con `POST /mercado/indicator-mapping/refresh`.

Cuando ESIOS publique nuevos indicadores, el sistema los vera automaticamente al expirar la cache o al forzar refresh.

## Persistencia

Las confirmaciones manuales se guardan en `mercado_indicator_mapping_confirmations`.

Solo se persiste la decision del usuario cuando el ranking no sea suficiente. El descubrimiento sigue siendo dinamico.

## Endpoints

- `GET /mercado/indicator-mapping`: devuelve mapping cacheado o recien calculado.
- `POST /mercado/indicator-mapping/refresh`: invalida cache y recalcula.
- `POST /mercado/indicator-mapping/confirm`: confirma una variable con `indicatorId`, `geoId` y `geoKey`.

## Pruebas

Ejecutar:

```powershell
npm.cmd run test:mercado --workspace apps/api
```

Las pruebas cubren:

- normalizacion de texto;
- preferencia de prevision frente a potencia instalada;
- preferencia de PBF frente a potencia instalada para nuclear;
- filtrado previo de PBF/P48/PHF/potencia instalada por categoria funcional;
- cache, concurrencia e invalidacion despues de confirmar.
