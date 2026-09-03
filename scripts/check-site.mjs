import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const failures = [];

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    if (name === ".git" || name === "node_modules") return [];
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

function count(source, pattern) {
  return (source.match(pattern) || []).length;
}

function fail(file, message) {
  failures.push(`${relative(root, file)}: ${message}`);
}

const htmlFiles = walk(root).filter((file) => file.endsWith(".html"));
const publicTextFiles = walk(root).filter((file) => /\.(?:html|css|js|mjs|md|txt)$/i.test(file));

for (const file of htmlFiles) {
  const source = readFileSync(file, "utf8");
  if (!/<html\s[^>]*lang=["'][^"']+["']/i.test(source)) fail(file, "atributo lang ausente");
  if (!/<meta\s[^>]*name=["']viewport["']/i.test(source)) fail(file, "meta viewport ausente");
  if (!/<title>[^<]+<\/title>/i.test(source)) fail(file, "title ausente");
  if (count(source, /<main\b/gi) !== 1) fail(file, "deve existir exatamente um main");
  if (count(source, /<h1\b/gi) !== 1) fail(file, "deve existir exatamente um h1");

  const ids = Array.from(source.matchAll(/\sid=["']([^"']+)["']/gi), (match) => match[1]);
  const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);
  if (duplicates.length) fail(file, `IDs duplicados: ${[...new Set(duplicates)].join(", ")}`);

  for (const match of source.matchAll(/\s(?:href|src)=["']([^"']+)["']/gi)) {
    const value = match[1];
    if (/^(?:https?:|mailto:|tel:|data:|javascript:|#)/i.test(value)) continue;
    const clean = value.split(/[?#]/)[0];
    if (!clean) continue;
    let target = resolve(dirname(file), clean);
    if (clean.endsWith("/") || (existsSync(target) && statSync(target).isDirectory())) target = join(target, "index.html");
    if (!existsSync(target)) fail(file, `referência local inexistente: ${value}`);
  }
}

const forbidden = [
  [/UA-\d+/i, "identificador legado de analytics"],
  [/GTM-[A-Z0-9]+/i, "identificador de tag manager"],
  [/rdstation[-]forms/i, "biblioteca de formulário ativa"],
  [/(?:api[_-]?key|client[_-]?secret|private[_-]?key)\s*[:=]/i, "possível segredo"],
];

for (const file of publicTextFiles) {
  const source = readFileSync(file, "utf8");
  for (const [pattern, label] of forbidden) {
    if (pattern.test(source)) fail(file, label);
  }
}

if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}

console.log(`Site validado: ${htmlFiles.length} páginas, links locais e privacidade sem falhas.`);
