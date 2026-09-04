@echo off
setlocal EnableExtensions EnableDelayedExpansion
cd /d "%~dp0"
title Programa WIN - Servidor local

echo.
echo ========================================
echo   Programa WIN - inicializacao local
echo ========================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo ERRO: Node.js nao foi encontrado.
  echo Instale o Node.js 20.11 ou superior e execute este arquivo novamente.
  goto :erro
)

node -e "const [major,minor]=process.versions.node.split('.').map(Number);process.exit(major>20||(major===20&&minor>=11)?0:1)"
if errorlevel 1 (
  echo ERRO: a versao instalada do Node.js e antiga.
  node --version
  goto :erro
)

set "NEED_INSTALL=0"
if not exist "node_modules\.bin\tsx.cmd" set "NEED_INSTALL=1"
if not exist "node_modules\fastify\package.json" set "NEED_INSTALL=1"
if not exist "node_modules\@electric-sql\pglite\package.json" set "NEED_INSTALL=1"

if "!NEED_INSTALL!"=="1" (
  echo Instalando dependencias pela primeira vez. Isso leva alguns minutos...
  call npm ci --no-audit --no-fund || goto :erro
)

if not exist ".pgdata" mkdir ".pgdata"
set "NODE_ENV=test"
set "AUTH_TEST_MODE=true"
set "WIN_DECISION_APPROVER=Aprovador Sintetico - teste local"
set "PORT="
for /f "delims=" %%P in ('node scripts\find-port.mjs 3000 3010') do set "PORT=%%P"
if not defined PORT (
  echo ERRO: nenhuma porta livre foi encontrada entre 3000 e 3010.
  goto :erro
)
set "APP_BASE_URL=http://127.0.0.1:%PORT%"
if not "%PORT%"=="3000" echo Aviso: a porta 3000 esta ocupada. O WIN usara a porta %PORT%.

echo Preparando o banco local...
call npm run db:migrate || goto :erro
call npm run db:seed || goto :erro

echo.
echo Programa WIN iniciando em http://127.0.0.1:%PORT%
echo O navegador abrira automaticamente. Pressione Ctrl+C para encerrar.
echo.
start "" powershell -NoProfile -WindowStyle Hidden -Command "$base='http://127.0.0.1:%PORT%'; for($i=0; $i -lt 90; $i++){ try { $health=Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 ($base+'/healthz'); $css=Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 ($base+'/assets/win.css?v=0.3.0'); $js=Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 ($base+'/assets/win-boot.js?v=0.3.0'); $logo=Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 ($base+'/assets/logo-locatelli-clara.png'); if($health.StatusCode -eq 200 -and $css.RawContentLength -gt 100 -and $js.RawContentLength -gt 100 -and $logo.RawContentLength -gt 100){ Start-Process ($base+'/'); exit 0 } } catch {}; Start-Sleep -Seconds 1 }; exit 1"
call npm start
goto :fim

:erro
echo.
echo  Falha na inicializacao. Veja a mensagem acima.
echo.
pause
exit /b 1

:fim
endlocal
