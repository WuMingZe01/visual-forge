@echo off
echo === Checking ports ===
netstat -ano | findstr ":3000" | findstr "LISTENING"
if %errorlevel%==0 (echo PORT_3000_IN_USE) else (echo PORT_3000_FREE)
netstat -ano | findstr ":5174" | findstr "LISTENING"
if %errorlevel%==0 (echo PORT_5174_IN_USE) else (echo PORT_5174_FREE)
echo === Node.js ===
where node
echo === NPM ===
call npm --version
echo === Node modules ===
if exist "d:\Cloud工作区\visual-forge-main\web\node_modules\.package-lock.json" (echo NODE_MODULES_OK) else (echo NODE_MODULES_MISSING)
echo === DONE ===
