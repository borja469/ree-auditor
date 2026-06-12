# REE Auditor

Monorepo para auditar, conciliar y reconstruir liquidaciones REE `REGANECU` y `REGANECUQH` de Facturacion A1.

## Arquitectura

- `apps/api`: API NestJS + TypeScript + Prisma.
- `apps/web`: Frontend React + Vite.
- `apps/api/prisma`: esquema PostgreSQL con `ree_files`, `reganecu_records` y `reganecu_qh_records`.
- `samples`: ejemplos minimos A1 para pruebas.

El importador usa la metadata oficial desde el nombre del fichero:

```text
C2_reganecu_20260203_18XENERGYSTROMXZ
```

Interpretacion:

- `version`: `C2`
- `tipo_archivo`: `REGANECU`
- `fecha_liquidacion`: `2026-02-03`
- `sujeto_eic`: `18XENERGYSTROMXZ`

## Puesta en marcha

```powershell
npm.cmd install
Copy-Item .env.example .env
npm.cmd run docker:up
```

Servicios:

- Frontend: http://localhost:5173
- API: http://localhost:3000
- PostgreSQL: `localhost:5432`

## Desarrollo sin Docker

```powershell
npm.cmd install
Copy-Item .env.example .env
npm.cmd run db:generate
npm.cmd run db:push
npm.cmd run dev:api
npm.cmd run dev:web
```

Si ya existe una base con el modelo anterior, `prisma db push` puede avisar de perdida de datos porque el modelo se ha refactorizado a tablas A1. Para produccion conviene crear una migracion revisada antes de aplicar el cambio.

## Cliente OMIE SIOM2

El backend incluye una capa de conexion HTTPS mTLS para SIOM2 usando certificados PKCS12 (`.p12` / `.pfx`) y ensamblado local de SOAP firmado XMLDSIG. No realiza todavia POST real a OMIE, parser de respuesta, attachments MIME ni validacion XSD.

Variables soportadas:

```text
OMIE_SIOM2_ENDPOINT=https://www.mercado.omie.es/jsiom/webServices/SIOMServiceRouter
OMIE_SIOM2_P12_PATH=/ruta/en/contenedor/certificado.p12
OMIE_SIOM2_P12_BASE64=
OMIE_SIOM2_P12_PASSPHRASE=
OMIE_SIOM2_REJECT_UNAUTHORIZED=true
OMIE_SIOM2_DNS_SERVERS=1.1.1.1,8.8.8.8
OMIE_SIOM2_TIMEOUT_MS=30000
```

Usa `OMIE_SIOM2_P12_BASE64` si no quieres montar el certificado como fichero dentro del contenedor. No subas certificados reales al repositorio.

Ejemplos de ensamblado local de SOAP firmado:

```ts
const signedSoap = await omieSiom2Client.createSignedSoapRequest("ServicioConsultaDatosUsuario");
```

```ts
const signedSoap = await omieSiom2Client.createSignedSoapRequest(
  "ServicioAltaOfertasMD",
  "<MensajeOfertasMD>...</MensajeOfertasMD>"
);
```

## API principal

```bash
GET  /health
GET  /imports
GET  /imports/:id
POST /imports/reganecu

GET  /reganecu
GET  /reganecu/:id
GET  /reganecu-qh
GET  /reganecu-qh/:id

GET  /settlements/summary
GET  /settlements/hourly
GET  /settlements/qh
GET  /settlements/compare-versions
```

Filtros soportados: `fecha`, `version`, `brp`, `sujeto`, `segmento`, `codigoApunte`, `codigoPrecio`, `eicUpr`, `skip`, `take`.

Ejemplo:

```bash
curl -F "files=@samples/C1_reganecu_20241031_18XENERGYSTROMXZ.csv" -F "files=@samples/C1_reganecuQH_20241031_18XENERGYSTROMXZ.csv" http://localhost:3000/imports/reganecu
curl "http://localhost:3000/settlements/summary?fecha=2024-10-31&version=C1"
```

La API soporta TXT, CSV y ZIP, detecta UTF-8/Latin1, delimitadores comunes, aplica `signo_importe` y `signo_magnitud`, calcula `importe_calculado_eur`, valida diferencias de importe y evita duplicados por hash de fichero y clave logica de registro.
