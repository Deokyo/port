import net from "node:net";

const start = Number.parseInt(process.argv[2] || "3000", 10);
const end = Number.parseInt(process.argv[3] || String(start), 10);

if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end > 65535 || start > end) {
  console.error("Intervalo de portas invalido.");
  process.exit(2);
}

function isAvailable(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.unref();
    server.once("error", () => resolve(false));
    server.listen({ host: "127.0.0.1", port, exclusive: true }, () => {
      server.close(() => resolve(true));
    });
  });
}

for (let port = start; port <= end; port += 1) {
  if (await isAvailable(port)) {
    console.log(port);
    process.exit(0);
  }
}

console.error(`Nenhuma porta livre entre ${start} e ${end}.`);
process.exit(1);
