import Anthropic from "@anthropic-ai/sdk";

const MODEL = process.env.CLAUDE_MODEL || "claude-opus-5";
const WORDS_PER_SECTION = 2000;

const FORMATS = {
  film: "een speelfilmscenario in standaard scenario-opmaak (SCÈNEKOPPEN zoals INT./EXT. LOCATIE - DAG, actieregels, PERSONAGENAMEN in hoofdletters boven de dialoog)",
  serie: "een aflevering van een tv-serie in standaard scenario-opmaak (SCÈNEKOPPEN, actieregels, PERSONAGENAMEN in hoofdletters boven de dialoog)",
  toneel: "een toneelstuk (bedrijven en scènes, regieaanwijzingen tussen haakjes, PERSONAGENAMEN in hoofdletters voor hun tekst)",
  hoorspel: "een hoorspel/podcastdrama (GELUID:- en MUZIEK:-aanwijzingen, PERSONAGENAMEN in hoofdletters voor hun tekst)",
  youtube: "een videoscript voor YouTube/documentaire (VOICE-OVER-tekst, [BEELD]-aanwijzingen, duidelijke hoofdstukken)",
};

export function countWords(text) {
  const m = text.trim().match(/\S+/g);
  return m ? m.length : 0;
}

function systemPrompt({ format, language }) {
  return [
    `Je bent een ervaren, bekroonde scenarist. Je schrijft ${FORMATS[format] || FORMATS.film}.`,
    `Schrijf in het ${language}.`,
    "Schrijf levendige, specifieke scènes met sterke dialogen, subtekst en concrete details.",
    "Personages blijven consistent in stem, motivatie en kennis. Herhaal geen scènes of dialogen die al geschreven zijn.",
  ].join("\n");
}

const OUTLINE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["title", "logline", "characters", "sections"],
  properties: {
    title: { type: "string" },
    logline: { type: "string" },
    characters: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "description"],
        properties: { name: { type: "string" }, description: { type: "string" } },
      },
    },
    sections: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "summary"],
        properties: { title: { type: "string" }, summary: { type: "string" } },
      },
    },
  },
};

function requestOptions(extra) {
  return {
    model: MODEL,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    thinking: { type: "adaptive" },
    ...extra,
  };
}

function checkStop(message) {
  if (message.stop_reason === "refusal") {
    const why = message.stop_details?.explanation || "geen reden opgegeven";
    throw new Error(`Het model weigerde dit verzoek: ${why}`);
  }
}

async function createOutline(client, opts, sectionCount) {
  const prompt = [
    `Maak een gedetailleerde outline voor dit script.`,
    `Idee / premisse: ${opts.premise}`,
    opts.genre ? `Genre: ${opts.genre}` : "",
    opts.notes ? `Extra wensen: ${opts.notes}` : "",
    "",
    `Het volledige script wordt ongeveer ${opts.targetWords} woorden lang en wordt in precies ${sectionCount} opeenvolgende delen geschreven (elk ~${Math.round(opts.targetWords / sectionCount)} woorden).`,
    `Geef exact ${sectionCount} secties. Elke samenvatting beschrijft concreet de scènes, wendingen en emotionele ontwikkeling van dat deel (4-8 zinnen), zodat een schrijver het deel zelfstandig kan uitwerken.`,
    "De secties vormen samen een complete boog met begin, opbouw, climax en afronding.",
  ].filter(Boolean).join("\n");

  const stream = client.beta.messages.stream(requestOptions({
    max_tokens: 16000,
    system: systemPrompt(opts),
    output_config: { format: { type: "json_schema", schema: OUTLINE_SCHEMA } },
    messages: [{ role: "user", content: prompt }],
  }));
  const message = await stream.finalMessage();
  checkStop(message);
  const text = message.content.filter((b) => b.type === "text").map((b) => b.text).join("");
  const outline = JSON.parse(text);
  if (!outline.sections?.length) throw new Error("Outline bevat geen secties.");
  return outline;
}

function outlineText(outline) {
  const chars = outline.characters.map((c) => `- ${c.name}: ${c.description}`).join("\n");
  const secs = outline.sections.map((s, i) => `${i + 1}. ${s.title}\n   ${s.summary}`).join("\n");
  return `TITEL: ${outline.title}\nLOGLINE: ${outline.logline}\n\nPERSONAGES:\n${chars}\n\nOUTLINE:\n${secs}`;
}

function tail(text, words) {
  const all = text.trim().split(/\s+/);
  return all.slice(Math.max(0, all.length - words)).join(" ");
}

async function* streamText(client, params) {
  const stream = client.beta.messages.stream(params);
  for await (const event of stream) {
    if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
      yield event.delta.text;
    }
  }
  const message = await stream.finalMessage();
  checkStop(message);
}

/**
 * Generates a long script in steps: first an outline, then each section in turn.
 * Yields progress events: {type: "outline" | "section_start" | "text" | "section_done" | "done", ...}.
 */
export async function* generateScript(rawOpts, { client = new Anthropic() } = {}) {
  const opts = {
    premise: String(rawOpts.premise || "").trim(),
    genre: String(rawOpts.genre || "").trim(),
    notes: String(rawOpts.notes || "").trim(),
    format: FORMATS[rawOpts.format] ? rawOpts.format : "film",
    language: String(rawOpts.language || "Nederlands").trim(),
    targetWords: Math.min(50000, Math.max(1000, Number(rawOpts.targetWords) || 20000)),
  };
  if (!opts.premise) throw new Error("Vul een idee of premisse in.");

  const sectionCount = Math.max(1, Math.round(opts.targetWords / WORDS_PER_SECTION));
  const outline = await createOutline(client, opts, sectionCount);
  yield { type: "outline", outline };

  // The outline is identical for every section request, so it is cached.
  const system = [
    { type: "text", text: systemPrompt(opts) },
    { type: "text", text: outlineText(outline), cache_control: { type: "ephemeral" } },
  ];

  let script = `${outline.title.toUpperCase()}\n\n`;
  let total = 0;
  const sections = outline.sections;

  for (let i = 0; i < sections.length; i++) {
    const remaining = opts.targetWords - total;
    const goal = Math.max(500, Math.round(remaining / (sections.length - i)));
    yield { type: "section_start", index: i, title: sections[i].title, goal };

    let sectionText = "";
    // Up to two continuation rounds if a section comes out clearly too short.
    for (let round = 0; round < 3; round++) {
      const written = countWords(sectionText);
      if (round > 0 && written >= goal * 0.85) break;
      const previous = tail(script + sectionText, 900);
      const instruction = round === 0
        ? [
            `Schrijf nu deel ${i + 1} van ${sections.length}: "${sections[i].title}".`,
            `Inhoud van dit deel: ${sections[i].summary}`,
            `Lengte: ongeveer ${goal} woorden. Werk de scènes volledig uit met dialoog en actie; vat niets samen.`,
            i + 1 < sections.length
              ? "Stop aan het einde van dit deel; begin niet aan het volgende deel."
              : "Dit is het laatste deel: rond het verhaal volledig af en eindig met EINDE.",
          ]
        : [
            `Ga naadloos verder met deel ${i + 1} ("${sections[i].title}") precies waar de tekst hieronder stopt.`,
            `Schrijf nog ongeveer ${goal - written} woorden die de inhoud van dit deel verder uitwerken: ${sections[i].summary}`,
            "Herhaal niets wat al geschreven is.",
          ];
      const content = [
        previous ? `LAATSTE STUK VAN HET SCRIPT TOT NU TOE:\n"""\n${previous}\n"""\n` : "",
        ...instruction,
        "Geef alleen de scripttekst zelf, zonder inleiding, uitleg of commentaar, en zonder de titel van het deel te herhalen.",
      ].filter(Boolean).join("\n");

      let chunk = round === 0 ? "" : "\n\n";
      if (round > 0) yield { type: "text", text: chunk };
      for await (const piece of streamText(client, requestOptions({
        max_tokens: 64000,
        system,
        output_config: { effort: "high" },
        messages: [{ role: "user", content }],
      }))) {
        chunk += piece;
        yield { type: "text", text: piece };
      }
      sectionText += chunk;
    }

    const sectionWords = countWords(sectionText);
    total += sectionWords;
    script += sectionText.trim() + "\n\n";
    yield { type: "section_done", index: i, words: sectionWords, total };
  }

  yield { type: "done", title: outline.title, words: countWords(script), script };
}
