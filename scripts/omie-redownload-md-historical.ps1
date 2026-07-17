param(
  [string]$BaseUrl = "http://localhost:8080/api",
  [string]$Username = "operaciones",
  [datetime]$FechaInicio = [datetime]"2025-01-01",
  [datetime]$FechaFin = [datetime]"2025-09-30",
  [string]$LogPath = "F:\ree-auditor\logs\omie-redescarga-md-20250101-20250930.csv",
  [int]$SleepSeconds = 2
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

if (-not (Test-Path $LogPath)) {
  "fecha,estado,registros,downloadId,mensaje" | Out-File -FilePath $LogPath -Encoding UTF8
}

$password = ConvertTo-PlainText (Read-Host "Password API para $Username" -AsSecureString)
$headers = Login-Api -ApiBaseUrl $BaseUrl -ApiUsername $Username -ApiPassword $password

$alreadyOk = @{}
Import-Csv $LogPath | Where-Object { $_.estado -eq "OK" } | ForEach-Object {
  $alreadyOk[$_.fecha] = $true
}

$fecha = $FechaInicio
while ($fecha -le $FechaFin) {
  $fechaTexto = $fecha.ToString("yyyy-MM-dd")

  if ($alreadyOk.ContainsKey($fechaTexto)) {
    Write-Host "OMITIDO $fechaTexto - ya estaba OK en el log"
    $fecha = $fecha.AddDays(1)
    continue
  }

  Write-Host "Redescargando MD $fechaTexto..."
  $body = @{
    codigoOmie = "5202"
    fecha = $fechaTexto
  } | ConvertTo-Json

  try {
    try {
      $result = Invoke-RestMethod `
        -Uri "$BaseUrl/omie/descargas/ejecutar?force=true" `
        -Method Post `
        -Headers $headers `
        -ContentType "application/json" `
        -Body $body `
        -TimeoutSec 900
    } catch {
      if ($_.Exception.Response.StatusCode.value__ -eq 401) {
        Write-Host "Token caducado. Renovando login..."
        $headers = Login-Api -ApiBaseUrl $BaseUrl -ApiUsername $Username -ApiPassword $password
        $result = Invoke-RestMethod `
          -Uri "$BaseUrl/omie/descargas/ejecutar?force=true" `
          -Method Post `
          -Headers $headers `
          -ContentType "application/json" `
          -Body $body `
          -TimeoutSec 900
      } else {
        throw
      }
    }

    $registros = $result.download.registros
    $downloadId = $result.download.id
    $message = $result.message
    if (-not $message) {
      $message = "Descarga procesada"
    }
    $message = $message.Replace('"', "'")
    "$fechaTexto,OK,$registros,$downloadId,""$message""" | Add-Content -Path $LogPath -Encoding UTF8
    Write-Host "OK $fechaTexto - $registros registros"
  } catch {
    $message = $_.Exception.Message.Replace('"', "'").Replace("`r", " ").Replace("`n", " ")
    "$fechaTexto,ERROR,0,,""$message""" | Add-Content -Path $LogPath -Encoding UTF8
    Write-Host "ERROR $fechaTexto - $message"
  }

  Start-Sleep -Seconds $SleepSeconds
  $fecha = $fecha.AddDays(1)
}

Write-Host "Proceso terminado. Log: $LogPath"
