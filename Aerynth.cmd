@echo off
pushd "%~dp0prototypes\visual-experience\cinematic-v3"
call npm run start -- %*
popd
