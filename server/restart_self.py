"""Self-restart: kill existing backend on port 3000, then restart with latest code."""
import subprocess, os, sys, time

os.chdir(r"d:\Cloud工作区\visual-forge-main\server")

# Kill existing process on port 3000
print("Killing old backend...")
subprocess.run(
    'for /f "tokens=5" %a in (\'netstat -ano ^| findstr ":3000" ^| findstr "LISTENING"\') do taskkill /f /pid %a',
    shell=True, capture_output=True
)
time.sleep(2)

# Restart
print("Restarting backend...")
subprocess.Popen(
    [r"d:\Cloud工作区\visual-forge-main\server\python\python.exe", "main.py"],
    cwd=r"d:\Cloud工作区\visual-forge-main\server",
    creationflags=subprocess.CREATE_NEW_CONSOLE
)
print("Done - backend restarting")
