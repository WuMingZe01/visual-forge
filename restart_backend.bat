@echo off
echo === Killing old Python and Node processes ===
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":3000" ^| findstr "LISTENING"') do taskkill /f /pid %%a
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":5174" ^| findstr "LISTENING"') do taskkill /f /pid %%a
echo === Waiting for ports to free ===
timeout /t 3 /nobreak >/dev/null
echo === Starting backend with latest code ===
cd /d d:\Cloud工作区\visual-forge-main\server
start "VF-Backend" /MIN python\python.exe main.py
echo === Backend started ===
exit
