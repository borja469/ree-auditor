# Despliegue Windows Server 2016

Guia para despliegue nativo en Windows Server 2016, sin Docker, para acceso interno por LAN.

## Resumen

- Frontend: estatico.
- API: servicio Windows con NSSM.
- PostgreSQL: instalado en Windows.
- Proxy recomendado: IIS o Nginx delante de `/api`.
- Compilacion frontend: `VITE_API_URL=/api` si se usa proxy.

## Requisitos

- Windows Server 2016 actualizado.
- Node.js 20 LTS o superior.
- Git.
- PostgreSQL 16 instalado en Windows.
- NSSM instalado.
- IIS con URL Rewrite y ARR, o Nginx para Windows.
- Carpetas persistentes:
  - `D:\ree-auditor\app`
  - `D:\ree-auditor\data`
  - `D:\ree-auditor\logs`
  - `D:\ree-auditor\uploads\tmp`
  - `D:\ree-auditor\backups`
  - `D:\ree-auditor\certs`
  - `D:\ree-auditor\config`

## Secuencia PowerShell

```powershell
$root = 'D:\ree-auditor'
$app = Join-Path $root 'app'
$data = Join-Path $root 'data'
$logs = Join-Path $root 'logs'
$tmpUploads = Join-Path $root 'uploads\tmp'
$backups = Join-Path $root 'backups'
$certs = Join-Path $root 'certs'
$config = Join-Path $root 'config'

New-Item -ItemType Directory -Force -Path $app, $data, $logs, $tmpUploads, $backups, $certs, $config | Out-Null

Set-Location $app
git clone <repo-url> .
npm ci
npm run prod:generate
npm run prod:build:api
$env:VITE_API_URL = '/api'
npm run prod:build:web
```

## Variables de entorno

Crear `D:\ree-auditor\config\.env.production` con al menos:

- `NODE_ENV=production`
- `PORT=3000`
- `DATABASE_URL=postgresql://...`
- `CORS_ORIGIN=http://intranet-ree-auditor`
- `APP_AUTH_USERNAME=operaciones`
- `APP_AUTH_PASSWORD=CHANGE_ME`
- `APP_AUTH_TOKEN_SECRET=CHANGE_ME_LONG_RANDOM_VALUE`
- `VITE_API_URL=/api` si hay proxy
- `DATA_DIR=D:\ree-auditor\data`
- `UPLOAD_TMP_DIR=D:\ree-auditor\uploads\tmp`
- `OMIE_SIOM2_P12_PATH=D:\ree-auditor\certs\omie-siom2.p12`
- `OMIE_SIOM2_P12_HOST_PATH=D:\ree-auditor\certs\omie-siom2.p12` solo si se reutiliza Docker en pruebas locales

No guardar secretos en el repositorio.

## PostgreSQL en Windows

Ruta tipica de binarios:

`C:\Program Files\PostgreSQL\16\bin\`

### Opcion A: pgAdmin

1. Abrir pgAdmin.
2. Crear usuario de aplicacion `ree_user`.
3. Crear base de datos `ree_auditor`.
4. Asignar propietario de la base a `ree_user`.
5. Otorgar permisos de conexion y escritura segun politica interna.

### Opcion B: PowerShell con ruta completa

```powershell
$pgBin = 'C:\Program Files\PostgreSQL\16\bin'
& "$pgBin\psql.exe" -U postgres -d postgres
```

Dentro de `psql`:

```sql
CREATE USER ree_user WITH PASSWORD 'CHANGE_ME';
CREATE DATABASE ree_auditor OWNER ree_user;
GRANT ALL PRIVILEGES ON DATABASE ree_auditor TO ree_user;
\q
```

Si se prefiere, `createdb.exe` tambien puede invocarse con ruta completa:

```powershell
& "C:\Program Files\PostgreSQL\16\bin\createdb.exe" -U postgres -O ree_user ree_auditor
```

No incluir contrasenas reales en la documentacion ni en scripts versionados.

## Prisma baseline

La migracion `20260626000000_initial_schema` representa el baseline versionado del `schema.prisma` actual.

Para una base existente creada con `prisma db push`:

1. Hacer backup obligatorio antes de tocar nada.
2. Verificar que el `schema.prisma` coincide con la base real.
3. Registrar la migracion inicial como ya aplicada:

```powershell
npx prisma migrate resolve --schema apps\api\prisma\schema.prisma --applied 20260626000000_initial_schema
```

4. Ejecutar migraciones pendientes:

```powershell
npm run prod:migrate
```

`migrate resolve` no modifica datos. Solo registra el estado de la migracion. El riesgo es marcar como aplicada una base que no coincida realmente con el schema, por lo que este paso debe ir siempre despues de backup y verificacion.

## Builds

API:

```powershell
Set-Location D:\ree-auditor\app
npm run prod:build:api
```

Frontend:

```powershell
Set-Location D:\ree-auditor\app
$env:VITE_API_URL = '/api'
npm run prod:build:web
```

`apps\web\public\web.config` se copia al build y cubre el fallback SPA, la compresion, el cache y el proxy de `/api`.

## Arranque de la API

Prueba manual:

```powershell
Set-Location D:\ree-auditor\app
$env:NODE_ENV = 'production'
$env:PORT = '3000'
$env:DATABASE_URL = 'postgresql://ree_user:CHANGE_ME@localhost:5432/ree_auditor?schema=public'
$env:CORS_ORIGIN = 'http://intranet-ree-auditor'
$env:DATA_DIR = 'D:\ree-auditor\data'
$env:UPLOAD_TMP_DIR = 'D:\ree-auditor\uploads\tmp'
$env:OMIE_SIOM2_P12_PATH = 'D:\ree-auditor\certs\omie-siom2.p12'
npm run prod:start:api
```

Nota: el bootstrap actual de la API escucha en `0.0.0.0`. Si se quiere binding real a `127.0.0.1`, hace falta un cambio de codigo. Sin tocar codigo, la proteccion debe hacerse con firewall y proxy local delante de 80/443.

## NSSM

Instalacion del servicio recomendado:

```powershell
$nssm = 'C:\Tools\nssm\nssm.exe'
& $nssm install ree-auditor-api 'C:\Program Files\nodejs\node.exe' 'D:\ree-auditor\app\apps\api\dist\main.js'
& $nssm set ree-auditor-api AppDirectory 'D:\ree-auditor\app'
& $nssm set ree-auditor-api AppEnvironmentExtra 'NODE_ENV=production' 'PORT=3000' 'DATABASE_URL=postgresql://ree_user:CHANGE_ME@localhost:5432/ree_auditor?schema=public' 'CORS_ORIGIN=http://intranet-ree-auditor' 'APP_AUTH_USERNAME=operaciones' 'APP_AUTH_PASSWORD=CHANGE_ME' 'APP_AUTH_TOKEN_SECRET=CHANGE_ME_LONG_RANDOM_VALUE' 'DATA_DIR=D:\ree-auditor\data' 'UPLOAD_TMP_DIR=D:\ree-auditor\uploads\tmp' 'OMIE_SIOM2_P12_PATH=D:\ree-auditor\certs\omie-siom2.p12'
& $nssm set ree-auditor-api AppStdout 'D:\ree-auditor\logs\api-out.log'
& $nssm set ree-auditor-api AppStderr 'D:\ree-auditor\logs\api-error.log'
& $nssm set ree-auditor-api AppStopMethodConsole 15000
& $nssm set ree-auditor-api AppExit Default Restart
& $nssm start ree-auditor-api
```

Operaciones:

```powershell
& $nssm stop ree-auditor-api
& $nssm restart ree-auditor-api
& $nssm remove ree-auditor-api confirm
```

## IIS / Nginx y `/api`

Recomendacion:

- Servir el frontend estatico desde `D:\ree-auditor\app\apps\web\dist`.
- Exponer la API solo a traves del proxy.
- Compilar el frontend con `VITE_API_URL=/api`.

### IIS

1. Crear un sitio apuntando a `D:\ree-auditor\app\apps\web\dist`.
2. Habilitar Static Content.
3. Instalar URL Rewrite y ARR.
4. Redirigir `/api/*` a `http://127.0.0.1:3000/*`.
5. Mantener abiertos solo 80 y 443 desde la LAN.
6. Bloquear 3000 en el firewall para evitar exposicion directa de la API.

### Checklist IT IIS

- Instalar URL Rewrite.
- Instalar ARR.
- Habilitar proxy en ARR.
- Crear `Site` para el frontend.
- Crear `Application Pool` dedicado.
- Publicar la carpeta `apps\web\dist`.
- Verificar que `web.config` esté presente en la carpeta publicada.
- Comprobar `GET /health`.
- Comprobar que el frontend abre.
- Comprobar que `GET /api/health` responde a traves del proxy.
- Revisar MIME types, compresion y cache.

### Nginx

```nginx
server {
  listen 80;
  server_name intranet-ree-auditor;
  root D:/ree-auditor/app/apps/web/dist;
  index index.html;

  location /api/ {
    proxy_pass http://127.0.0.1:3000/;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }

  location / {
    try_files $uri $uri/ /index.html;
  }
}
```

## Backups y rollback

### PostgreSQL

Backup:

```powershell
$pgBin = 'C:\Program Files\PostgreSQL\16\bin'
& "$pgBin\pg_dump.exe" -U ree_user -Fc -f "D:\ree-auditor\backups\ree_auditor_$(Get-Date -Format yyyyMMdd_HHmmss).dump" ree_auditor
```

Restore:

```powershell
& "$pgBin\pg_restore.exe" -U ree_user -d ree_auditor -c "D:\ree-auditor\backups\ree_auditor_YYYYMMDD_HHMMSS.dump"
```

### Carpetas

```powershell
robocopy D:\ree-auditor\data D:\ree-auditor\backups\data /MIR /R:2 /W:5
robocopy D:\ree-auditor\certs D:\ree-auditor\backups\certs /MIR /R:2 /W:5
robocopy D:\ree-auditor\config D:\ree-auditor\backups\config /MIR /R:2 /W:5
```

### Git rollback

```powershell
git fetch --tags
git checkout <tag-anterior>
```

## Validacion frontend

- La URL base de la API se resuelve en `apps\web\src\api.ts`.
- Con `VITE_API_URL=/api`, las llamadas se construyen como `/api/...`.
- La ruta absoluta a `http://localhost:3000` solo aparece como fallback cuando `VITE_API_URL` no se define o queda en `auto`.
- No hay dependencia de React Router en el frontend actual; el fallback SPA de `web.config` sigue siendo el mecanismo correcto para refresh y deep links.

## Checklist final

- PostgreSQL instalado.
- Node instalado.
- Git instalado.
- NSSM instalado.
- IIS o Nginx decidido.
- `.env.production` creado.
- `CORS_ORIGIN` definido.
- `VITE_API_URL=/api` si hay proxy.
- `.p12` fuera del repo.
- Backup probado.
- `/health` probado.

## Riesgos pendientes

- `multer@2.1.1` sigue apareciendo via `@nestjs/platform-express`.
- `xlsx@0.18.5` no tiene fix utilizable ahora mismo.
- El arranque actual de la API escucha en `0.0.0.0`, no en `127.0.0.1`; el aislamiento real depende del proxy y del firewall.
- Los uploads usan temporal en disco, pero siguen dependiendo de permisos correctos sobre `D:\ree-auditor\uploads\tmp`.
- Los jobs ESIOS siguen dependiendo de credenciales y acceso externo.
- Los backups deben probar restauracion antes de la migracion real.
