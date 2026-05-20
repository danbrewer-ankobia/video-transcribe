@echo off
rem Cleanly ask the running server to shut down.
powershell -NoProfile -Command "try { Invoke-RestMethod -Method Post -Uri 'http://localhost:3001/api/quit' -TimeoutSec 2 | Out-Null; Write-Host 'Stopped.' } catch { Write-Host 'Not running (or already stopped).' }"
