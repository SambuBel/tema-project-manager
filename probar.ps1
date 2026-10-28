$ErrorActionPreference = 'Stop'
$taskRoot = $PSScriptRoot
$taskProcesses = @()
$taskEnvironment = @{
    NODE_ENV = 'development'
    POSTGRES_USER = 'tema'
    POSTGRES_PASSWORD = 'tema'
    POSTGRES_DB = 'tema_project_manager'
    POSTGRES_PORT = '55432'
    DATABASE_URL = 'postgresql://tema:tema@localhost:55432/tema_project_manager'
    BACKEND_PORT = '3001'
    CORS_ORIGIN = 'http://localhost:5174'
    FRONTEND_URL = 'http://localhost:5174'
    VITE_API_URL = 'http://localhost:3001'
    GOOGLE_CLIENT_ID = 'prueba-local-sin-google'
    GOOGLE_CLIENT_SECRET = 'prueba-local-sin-google'
    GOOGLE_CALLBACK_URL = 'http://localhost:3001/api/auth/google/callback'
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
    foreach ($taskPort in @(3001, 5174)) {
        $taskListener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Any, $taskPort)
        try { $taskListener.Start() }
        catch { throw "El puerto $taskPort esta ocupado. Cerra la otra prueba antes de continuar." }
        finally { $taskListener.Stop() }
    }
    foreach ($taskKey in $taskEnvironment.Keys) {
        $taskPreviousEnvironment[$taskKey] = [Environment]::GetEnvironmentVariable($taskKey, 'Process')
        [Environment]::SetEnvironmentVariable($taskKey, $taskEnvironment[$taskKey], 'Process')
    }

    # Solo este proyecto de Compose: otro contenedor, puerto y volumen.
    Invoke-Checked 'docker' @('compose', '-p', 'tema-prueba-ultimos-cambios', '-f', 'infra/docker-compose.yml', 'up', '-d', '--wait')
    Invoke-Checked 'npx.cmd' @('--yes', 'pnpm@9.12.0', 'exec', 'turbo', 'run', 'build', '--cache-dir=.turbo/cache')
    Invoke-Checked 'npx.cmd' @('--yes', 'pnpm@9.12.0', '--filter', '@tema/backend', 'migration:run')
    Invoke-Checked 'npx.cmd' @('--yes', 'pnpm@9.12.0', '--filter', '@tema/backend', 'seed')

    $taskNode = (Get-Command node.exe).Source
    $taskProcesses += Start-Process -FilePath $taskNode -ArgumentList 'dist/main.js' -WorkingDirectory (Join-Path $taskRoot 'apps/backend') -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $taskRoot 'prueba-backend.log') -RedirectStandardError (Join-Path $taskRoot 'prueba-backend-error.log')
    $taskProcesses += Start-Process -FilePath $taskNode -ArgumentList 'node_modules/vite/bin/vite.js', '--port', '5174', '--strictPort' -WorkingDirectory (Join-Path $taskRoot 'apps/frontend') -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $taskRoot 'prueba-frontend.log') -RedirectStandardError (Join-Path $taskRoot 'prueba-frontend-error.log')
    Write-Host 'Esperando que ambos servidores respondan...'
    $taskDeadline = [DateTime]::UtcNow.AddMinutes(3)
    $taskReady = $false
    while ([DateTime]::UtcNow -lt $taskDeadline) {
        foreach ($taskProcess in $taskProcesses) {
            if ($taskProcess.HasExited) { throw 'Un servidor termino. Revisa prueba-*-error.log.' }
        }
        try {
            $taskHealth = Invoke-RestMethod 'http://localhost:3001/api/health' -TimeoutSec 2
            $taskPage = Invoke-WebRequest 'http://localhost:5174/' -TimeoutSec 2 -UseBasicParsing
            if ($taskHealth.status -eq 'ok' -and $taskPage.StatusCode -eq 200) {
                $taskReady = $true
                break
            }
        }
        catch { Start-Sleep -Seconds 1 }
    }
    if (-not $taskReady) { throw 'Los servidores no respondieron en 3 minutos. Revisa prueba-*.log.' }
    Write-Host 'Frontend: http://localhost:5174 | API: http://localhost:3001/api/health'
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
