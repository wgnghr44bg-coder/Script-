import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { generateScript } from "./generator.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(here, "..", "public");
const outputDir = path.join(here, "..", "output");
const PORT = Number(process.env.PORT) || 3000;

async function readJson(req) {
  let body = "";
  for await (const chunk of req) body += chunk;
  return JSON.parse(body || "{}");
}

function safeName(title) {
  return (title || "script").replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "").slice(0, 60) || "script";
}

async function handleGenerate(req, res) {
  let opts;
  try {
    opts = await readJson(req);
  } catch {
    res.writeHead(400).end("Ongeldige JSON");
    return;
  }

  // Newline-delimited JSON: one progress event per line.
  res.writeHead(200, { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-cache" });
  const send = (event) => res.write(JSON.stringify(event) + "\n");

  const abort = new AbortController();
  res.on("close", () => abort.abort());

  try {
    for await (const event of generateScript(opts)) {
      if (abort.signal.aborted) return;
      if (event.type === "done") {
        await fs.mkdir(outputDir, { recursive: true });
        const file = `${safeName(event.title)}-${Date.now()}.txt`;
        await fs.writeFile(path.join(outputDir, file), event.script, "utf8");
        send({ type: "done", title: event.title, words: event.words, file });
      } else {
        send(event);
      }
    }
  } catch (err) {
    console.error(err);
    const message = /authentication/i.test(err.message)
      ? "Geen API-sleutel gevonden. Start de server met ANTHROPIC_API_KEY=... npm start"
      : err.message || String(err);
    send({ type: "error", message });
  }
  res.end();
}

const server = http.createServer(async (req, res) => {
  if (req.method === "POST" && req.url === "/api/generate") return handleGenerate(req, res);
  if (req.method === "GET" && (req.url === "/" || req.url === "/index.html")) {
    const html = await fs.readFile(path.join(publicDir, "index.html"));
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }).end(html);
    return;
  }
  res.writeHead(404).end("Niet gevonden");
});

server.listen(PORT, () => {
  console.log(`Scriptschrijver draait op http://localhost:${PORT}`);
});
