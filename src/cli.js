import fs from "node:fs/promises";
import { parseArgs } from "node:util";
import { generateScript } from "./generator.js";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    format: { type: "string", default: "film" },
    genre: { type: "string", default: "" },
    language: { type: "string", default: "Nederlands" },
    words: { type: "string", default: "20000" },
    notes: { type: "string", default: "" },
    out: { type: "string", default: "script.txt" },
  },
});

const premise = positionals.join(" ");
if (!premise) {
  console.error('Gebruik: npm run cli -- "jouw idee" [--format film|serie|toneel|hoorspel|youtube] [--words 20000] [--out script.txt]');
  process.exit(1);
}

for await (const ev of generateScript({ ...values, premise, targetWords: Number(values.words) })) {
  if (ev.type === "outline") console.error(`Outline: "${ev.outline.title}" in ${ev.outline.sections.length} delen`);
  else if (ev.type === "section_start") console.error(`\n--- Deel ${ev.index + 1}: ${ev.title} (~${ev.goal} woorden)`);
  else if (ev.type === "text") process.stdout.write(ev.text);
  else if (ev.type === "section_done") console.error(`\n[deel ${ev.index + 1}: ${ev.words} woorden, totaal ${ev.total}]`);
  else if (ev.type === "done") {
    await fs.writeFile(values.out, ev.script, "utf8");
    console.error(`\nKlaar: ${ev.words} woorden opgeslagen in ${values.out}`);
  }
}
