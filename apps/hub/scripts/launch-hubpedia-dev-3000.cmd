@echo off
cd /d C:\jkamma-platform\apps\hub
powershell.exe -NoProfile -WindowStyle Hidden -Command "Start-Process -FilePath 'C:\Program Files\nodejs\node.exe' -ArgumentList 'C:\jkamma-platform\apps\hub\scripts\hubpedia-watchdog.mjs' -WorkingDirectory 'C:\jkamma-platform\apps\hub' -WindowStyle Hidden"
