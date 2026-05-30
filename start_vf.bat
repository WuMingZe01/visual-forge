@echo off
cd /d d:\Cloud工作区\visual-forge-main
echo === Installing dependencies ===
cd web
call npm install
cd ..
echo === Freeing ports ===
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":3000" ^| findstr "LISTENING"') do taskkill /f /pid %%a 2>/dev/null
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":5174" ^| findstr "LISTENING"') do taskkill /f /pid %%a 2>/dev/null
echo === Starting backend ===
start "VF-Backend" /D "server" /MIN "python\python.exe" "main.py"
echo === Starting frontend ===
cd web
start "VF-Frontend" /MIN npx vite --host 0.0.0.0 --port 5174
echo === Done ===
exit
