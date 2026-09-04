#!/usr/bin/env bash
# Programa WIN — inicializacao local (piloto). Equivalente ao INICIAR-WIN.bat.
set -euo pipefail
cd "$(dirname "$0")"

command -v node >/dev/null || { echo "Node.js 20.11+ nao encontrado."; exit 1; }
node -e "const [major,minor]=process.versions.node.split('.').map(Number);process.exit(major>20||(major===20&&minor>=11)?0:1)"
[ -x node_modules/.bin/tsx ] || npm ci --no-audit --no-fund
mkdir -p .pgdata
PORT="$(node scripts/find-port.mjs 3000 3010)" || {
  echo "Nenhuma porta livre foi encontrada entre 3000 e 3010."
  exit 1
}
export NODE_ENV=test AUTH_TEST_MODE=true PORT APP_BASE_URL="http://127.0.0.1:${PORT}"
export WIN_DECISION_APPROVER="Aprovador Sintetico - teste local"
if [ "$PORT" != "3000" ]; then echo "A porta 3000 esta ocupada. O WIN usara a porta $PORT."; fi
npm run db:migrate
npm run db:seed
echo "Programa WIN em http://127.0.0.1:${PORT}/"
npm start
