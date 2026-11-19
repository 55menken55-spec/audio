@echo off
cd /d "%~dp0"
where py >nul 2>nul
if errorlevel 1 (
  echo Python 3 ne nayden. Ustanovite Python 3 s python.org, zatem zapustite fayl snova.
  pause
  exit /b 1
)
echo Otkroyte v Edge: http://localhost:8000
echo Ne zakryvayte eto okno vo vremya raboty.
start "" "http://localhost:8000"
py -3 -m http.server 8000 --bind 127.0.0.1
pause
