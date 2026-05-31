@echo off
set "ROOT=%~dp0"
set "ROOT=%ROOT:~0,-1%"
echo === Killing old Python and Node processes ===
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":3000" ^| findstr "LISTENING"') do taskkill /f /pid %%a
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":5174" ^| findstr "LISTENING"') do taskkill /f /pid %%a
echo === Waiting for ports to free ===
timeout /t 3 /nobreak >nul
echo === Starting backend with latest code ===
start "VF-Backend" /MIN /D "%ROOT%\server" "%ROOT%\server\python\python.exe" "%ROOT%\server\main.py"
echo === Backend started ===
exit
