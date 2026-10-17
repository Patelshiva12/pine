@echo off
title Pines Exotica Server
color 0A
echo ======================================================
echo         PINES EXOTICA - ORDERING & MANAGEMENT SYSTEM
echo ======================================================
echo.
cd /d "%~dp0"

echo Starting server...
echo Server running on: http://localhost:8080
echo.
echo Pages available:
echo   - Guest Menu   : http://localhost:8080/
echo   - Kitchen      : http://localhost:8080/kitchen
echo   - Room Service : http://localhost:8080/service
echo   - Admin Panel  : http://localhost:8080/admin
echo.
echo Press Ctrl+C to stop the server.
echo ======================================================
echo.

npm start
pause
