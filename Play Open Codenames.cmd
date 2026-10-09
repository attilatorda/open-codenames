@echo off
rem Play Open Codenames (debug build: the offline mock AI is available in AI configuration).
rem The release build for players is release\desktop\win-unpacked\Open Codenames.exe.
set ELECTRON_RUN_AS_NODE=
start "" "%~dp0release\debug\win-unpacked\Open Codenames Debug.exe"
