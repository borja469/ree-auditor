param(
  [string]$BaseUrl = "http://localhost:8080/api",
  [string]$Username = "operaciones",
  [datetime]$FechaInicio = [datetime]"2026-01-01",
  [datetime]$FechaFin = [datetime]"2026-12-31",
  [string]$LogPath = "F:\ree-auditor\logs\mibgas-transacciones-3140-historico.csv",
  [int]$SleepSeconds = 2,
  [switch]$Force
)

$ErrorActionPreference = "Stop"

New-Item -ItemType Directory -Force -Path (Split-Path $LogPath) | Out-Null

function ConvertTo-PlainText([securestring]$SecureText) {
  $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($SecureText)
  try {
    return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)
  } finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)
  }
}

function Login-Api {
  param(
    [string]$ApiBaseUrl,
    [string]$ApiUsername,
    [string]$ApiPassword
  )

  $login = Invoke-RestMethod `
    -Uri "$ApiBaseUrl/auth/login" `
    -Method Post `
    -ContentType "application/json" `
    -Body (@{
      username = $ApiUsername
      password = $ApiPassword
    } | ConvertTo-Json)

  return @{
    Authorization = "Bearer $($login.token)"
  }
}

function Invoke-MibgasTransactionDownload {
  param(
    [string]$ApiBaseUrl,
    [hashtable]$ApiHeaders,
    [string]$SessionDate,
    [bool]$ForceDownload
  )

  $forceQuery = if ($ForceDownload) { "?force=true" } else { "" }
  return Invoke-RestMethod `
    -Uri "$ApiBaseUrl/mibgas/private/downloads/transactions$forceQuery" `
    -Method Post `
    -Headers $ApiHeaders `
    -ContentType "application/json" `
    -Body (@{
      sessionDate = $SessionDate
      queryCode = "3140"
    } | ConvertTo-Json) `
    -TimeoutSec 900
}

function CsvText([object]$Value) {
  if ($null -eq $Value) {
    return ""
  }
  return ([string]$Value).Replace('"', "'").Replace("`r", " ").Replace("`n", " ")
}

if (-not (Test-Path $LogPath)) {
  "fecha,estado,registros,downloadId,mensaje" | Out-File -FilePath $LogPath -Encoding UTF8
}

$password = ConvertTo-PlainText (Read-Host "Password API para $Username" -AsSecureString)
$headers = Login-Api -ApiBaseUrl $BaseUrl -ApiUsername $Username -ApiPassword $password

$alreadyOk = @{}
Import-Csv $LogPath | Where-Object { $_.estado -eq "OK" -or $_.estado -eq "SIN_DATOS" } | ForEach-Object {
  $alreadyOk[$_.fecha] = $true
}

$fecha = $FechaInicio
while ($fecha -le $FechaFin) {
  $fechaTexto = $fecha.ToString("yyyy-MM-dd")

  if (-not $Force -and $alreadyOk.ContainsKey($fechaTexto)) {
    Write-Host "OMITIDO $fechaTexto - ya estaba OK/SIN_DATOS en el log"
    $fecha = $fecha.AddDays(1)
    continue
  }

  Write-Host "Descargando MIBGAS 3140 $fechaTexto..."

  try {
    try {
      $result = Invoke-MibgasTransactionDownload -ApiBaseUrl $BaseUrl -ApiHeaders $headers -SessionDate $fechaTexto -ForceDownload ([bool]$Force)
    } catch {
      if ($_.Exception.Response.StatusCode.value__ -eq 401) {
        Write-Host "Token caducado. Renovando login..."
        $headers = Login-Api -ApiBaseUrl $BaseUrl -ApiUsername $Username -ApiPassword $password
        $result = Invoke-MibgasTransactionDownload -ApiBaseUrl $BaseUrl -ApiHeaders $headers -SessionDate $fechaTexto -ForceDownload ([bool]$Force)
      } else {
        throw
      }
    }

    $estado = if ($result.download.status -eq "SIN_DATOS") { "SIN_DATOS" } else { "OK" }
    $registros = $result.records
    if ($null -eq $registros) {
      $registros = $result.download.records
    }
    $downloadId = $result.download.id
    $message = CsvText $result.message
    if (-not $message) {
      $message = "Descarga procesada"
    }
    "$fechaTexto,$estado,$registros,$downloadId,""$message""" | Add-Content -Path $LogPath -Encoding UTF8
    Write-Host "$estado $fechaTexto - $registros registros"
  } catch {
    $message = CsvText $_.Exception.Message
    "$fechaTexto,ERROR,0,,""$message""" | Add-Content -Path $LogPath -Encoding UTF8
    Write-Host "ERROR $fechaTexto - $message"
  }

  Start-Sleep -Seconds $SleepSeconds
  $fecha = $fecha.AddDays(1)
}

Write-Host "Proceso terminado. Log: $LogPath"
