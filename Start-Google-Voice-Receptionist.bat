@echo off
title IWG Receptionist - Google Voice Auto-Answer Launcher (480) 331-9455
echo ============================================================================
echo   IWG RECEPTIONIST ^& OUTBOUND CALLER - GOOGLE VOICE AUTO-ANSWER (480) 331-9455
echo ============================================================================
echo.
set "EXT_DIR=%~dp0google-voice-extension"
echo Launching Google Voice with IWG Receptionist Auto-Answer Extension...
echo Extension Folder: %EXT_DIR%
echo.
start "" "C:\Program Files\Google\Chrome\Application\chrome.exe" --load-extension="%EXT_DIR%" --autoplay-policy=no-user-gesture-required "https://voice.google.com/u/0/calls" "https://iwillglobal.com"

