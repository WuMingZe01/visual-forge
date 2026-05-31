@echo off
set "ROOT=%~dp0"
set "ROOT=%ROOT:~0,-1%"
echo === Installing dependencies ===
cd /d "%ROOT%\web"
call npm install
cd /d "%ROOT%"
echo === Freeing ports ===
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":3000" ^| findstr "LISTENING"') do taskkill /f /pid %%a 2>nul
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":5174" ^| findstr "LISTENING"') do taskkill /f /pid %%a 2>nul
echo === Starting backend ===
start "VF-Backend" /D "%ROOT%\server" /MIN "%ROOT%\server\python\python.exe" "%ROOT%\server\main.py"
echo === Starting frontend ===
cd /d "%ROOT%\web"
start "VF-Frontend" /MIN npx vite --host 0.0.0.0 --port 5174
echo === Done ===
exit
