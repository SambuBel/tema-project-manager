[CmdletBinding()]
param(
    [ValidateRange(1024, 65535)][int]$DatabasePort = 55432,
    [ValidateRange(1024, 65535)][int]$BackendPort = 3001,
    [ValidateRange(1024, 65535)][int]$FrontendPort = 5174,
    [ValidatePattern('^tema-prueba-[a-z0-9_-]+$')][string]$ComposeProject = 'tema-prueba-ultimos-cambios',
    [ValidatePattern('^[a-zA-Z_][a-zA-Z0-9_]*$')][string]$DatabaseUser = 'tema',
    [ValidatePattern('^[a-zA-Z_][a-zA-Z0-9_]*$')][string]$DatabaseName = 'tema_project_manager',
    [Security.SecureString]$DatabasePassword
)

$ErrorActionPreference = 'Stop'
$taskRoot = $PSScriptRoot
$taskProcesses = @()
$taskEnvironment = @{
    NODE_ENV = 'development'
    POSTGRES_USER = $DatabaseUser
    POSTGRES_DB = $DatabaseName
    POSTGRES_PORT = [string]$DatabasePort
    BACKEND_PORT = [string]$BackendPort
    CORS_ORIGIN = "http://localhost:$FrontendPort"
    FRONTEND_URL = "http://localhost:$FrontendPort"
    VITE_API_URL = "http://localhost:$BackendPort"
    GOOGLE_CLIENT_ID = 'prueba-local-sin-google'
    GOOGLE_CLIENT_SECRET = 'prueba-local-sin-google'
    GOOGLE_CALLBACK_URL = "http://localhost:$BackendPort/api/auth/google/callback"
    JWT_SECRET = [Guid]::NewGuid().ToString('N') + [Guid]::NewGuid().ToString('N')
    JWT_EXPIRES_IN = '8h'
    GEMINI_API_KEY = ''
    GEMINI_MODEL = ''
    ENABLE_DEV_ENDPOINTS = 'false'
}
$taskPreviousEnvironment = @{}

function Invoke-Checked {
    param([string]$Program, [string[]]$Arguments)
    & $Program @Arguments
    if ($LASTEXITCODE -ne 0) { throw "$Program termino con codigo $LASTEXITCODE" }
}

Push-Location $taskRoot
try {
    foreach ($taskEnvFile in @('.env', 'apps/backend/.env', 'apps/frontend/.env')) {
        if (Test-Path -LiteralPath (Join-Path $taskRoot $taskEnvFile)) {
            throw 'Usa un checkout o worktree de prueba sin archivos .env para evitar cargar configuracion ajena a esta prueba.'
        }
    }
    if (@($DatabasePort, $BackendPort, $FrontendPort | Select-Object -Unique).Count -ne 3) {
        throw 'Los puertos de base de datos, API y frontend deben ser distintos.'
    }
    foreach ($taskPort in @($BackendPort, $FrontendPort)) {
        $taskListener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Any, $taskPort)
        try { $taskListener.Start() }
        catch { throw "El puerto $taskPort esta ocupado. Cerra la otra prueba antes de continuar." }
        finally { $taskListener.Stop() }
    }
    # Solo se usa la clave suministrada para esta base; no se leen archivos .env.
    if ($null -ne $DatabasePassword) {
        $taskDbPassword = [Net.NetworkCredential]::new('', $DatabasePassword).Password
    }
    elseif (-not [string]::IsNullOrEmpty($env:POSTGRES_PASSWORD)) {
        $taskDbPassword = $env:POSTGRES_PASSWORD
    }
    else {
        $DatabasePassword = Read-Host 'Clave de PostgreSQL de prueba (usar la misma si el volumen ya existe)' -AsSecureString
        $taskDbPassword = [Net.NetworkCredential]::new('', $DatabasePassword).Password
    }
    if ([string]::IsNullOrEmpty($taskDbPassword)) { throw 'La clave de PostgreSQL no puede estar vacia.' }
    $taskEnvironment.POSTGRES_PASSWORD = $taskDbPassword
    $taskEncodedPassword = [Uri]::EscapeDataString($taskDbPassword)
    $taskEnvironment.DATABASE_URL = "postgresql://${DatabaseUser}:${taskEncodedPassword}@localhost:${DatabasePort}/${DatabaseName}"
    foreach ($taskKey in $taskEnvironment.Keys) {
        $taskPreviousEnvironment[$taskKey] = [Environment]::GetEnvironmentVariable($taskKey, 'Process')
        [Environment]::SetEnvironmentVariable($taskKey, $taskEnvironment[$taskKey], 'Process')
    }

    # Solo este proyecto de Compose: otro contenedor, puerto y volumen.
    Write-Host '[1/5] Comprobando PostgreSQL independiente...'
    Invoke-Checked 'docker' @('compose', '-p', $ComposeProject, '-f', 'infra/docker-compose.yml', 'up', '-d', '--wait')
    # pnpm respeta el orden de dependencias del workspace. Evita el cierre de
    # Turbo que puede quedar esperando despues de "Finishing writing to cache".
    Write-Host '[2/5] Compilando los paquetes en orden, sin Turbo...'
    Invoke-Checked 'npx.cmd' @('--yes', 'pnpm@9.12.0', '--recursive', '--workspace-concurrency=1', 'run', 'build')
    Write-Host '[3/5] Verificando migraciones en la base de prueba...'
    Invoke-Checked 'npx.cmd' @('--yes', 'pnpm@9.12.0', '--filter', '@tema/backend', 'migration:run')
    Write-Host '[4/5] Verificando catalogos; los usuarios existentes se conservan...'
    Invoke-Checked 'npx.cmd' @('--yes', 'pnpm@9.12.0', '--filter', '@tema/backend', 'seed')

    Write-Host '[5/5] Iniciando API y frontend de prueba...'
    $taskNode = (Get-Command node.exe).Source
    $taskProcesses += Start-Process -FilePath $taskNode -ArgumentList 'dist/main.js' -WorkingDirectory (Join-Path $taskRoot 'apps/backend') -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $taskRoot 'prueba-backend.log') -RedirectStandardError (Join-Path $taskRoot 'prueba-backend-error.log')
    $taskProcesses += Start-Process -FilePath $taskNode -ArgumentList 'node_modules/vite/bin/vite.js', '--port', "$FrontendPort", '--strictPort' -WorkingDirectory (Join-Path $taskRoot 'apps/frontend') -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $taskRoot 'prueba-frontend.log') -RedirectStandardError (Join-Path $taskRoot 'prueba-frontend-error.log')
    Write-Host 'Esperando que ambos servidores respondan...'
    $taskDeadline = [DateTime]::UtcNow.AddMinutes(3)
    $taskReady = $false
    while ([DateTime]::UtcNow -lt $taskDeadline) {
        foreach ($taskProcess in $taskProcesses) {
            if ($taskProcess.HasExited) { throw 'Un servidor termino. Revisa prueba-*-error.log.' }
        }
        try {
            $taskHealth = Invoke-RestMethod "http://localhost:$BackendPort/api/health" -TimeoutSec 2
            $taskPage = Invoke-WebRequest "http://localhost:$FrontendPort/" -TimeoutSec 2 -UseBasicParsing
            if ($taskHealth.status -eq 'ok' -and $taskPage.StatusCode -eq 200) {
                $taskReady = $true
                break
            }
        }
        catch { Start-Sleep -Seconds 1 }
    }
    if (-not $taskReady) { throw 'Los servidores no respondieron en 3 minutos. Revisa prueba-*.log.' }
    Write-Host "Frontend: http://localhost:$FrontendPort | API: http://localhost:$BackendPort/api/health"
    Write-Host 'Logs: prueba-*.log. Ctrl+C detiene las aplicaciones; la base de prueba queda conservada.'
    Write-Host 'Base independiente con catalogos iniciales. Google deshabilitado y asistente en modo demo.'
    while ($true) {
        foreach ($taskProcess in $taskProcesses) {
            if ($taskProcess.HasExited) { throw "Un servidor termino. Revisa prueba-*-error.log." }
        }
        Start-Sleep -Seconds 1
    }
}
finally {
    foreach ($taskProcess in $taskProcesses) {
        if (-not $taskProcess.HasExited) { Stop-Process -Id $taskProcess.Id }
    }
    foreach ($taskKey in $taskPreviousEnvironment.Keys) {
        [Environment]::SetEnvironmentVariable($taskKey, $taskPreviousEnvironment[$taskKey], 'Process')
    }
    Pop-Location
}
