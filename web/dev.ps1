$ErrorActionPreference = "Stop"

$rootDir = "d:\Trae\项目\visual-forge-main"
$serverDir = "$rootDir\server"
$pythonExe = "$serverDir\python\python.exe"
$mainPy = "$serverDir\main.py"
$webDir = "$rootDir\web"

Write-Host "=== Visual Forge + Infinite Canvas ==="

# Clean port 3000
Write-Host "[Boot] Checking port 3000..."
Get-NetTCPConnection -LocalPort 3000 -ErrorAction SilentlyContinue |
    ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }

# Start Python backend
Write-Host "[Boot] Starting Python backend..."
Set-Location -LiteralPath $serverDir
$pyProc = Start-Process -FilePath $pythonExe -ArgumentList $mainPy -PassThru -WindowStyle Hidden
Write-Host "[Boot] Python PID: $($pyProc.Id)"

# Wait for backend
Write-Host "[Boot] Waiting 5s for backend..."
Start-Sleep -Seconds 5

# Start Vite
Write-Host "[Boot] Starting Vite dev server..."
Set-Location -LiteralPath $webDir

Write-Host ""
Write-Host "============================================"
Write-Host "  Visual Forge : http://localhost:5174"
Write-Host "  Canvas API   : http://localhost:3000"
Write-Host "============================================"
Write-Host ""

try {
    npx vite --port 5174
} finally {
    if ($pyProc -and !$pyProc.HasExited) {
        Stop-Process -Id $pyProc.Id -Force -ErrorAction SilentlyContinue
    }
    Write-Host "All services stopped."
}
