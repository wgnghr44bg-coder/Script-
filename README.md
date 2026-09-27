# Scriptschrijver

Een kleine webapp (plus commandline-tool) die met Claude een compleet script van ongeveer **20.000 woorden** schrijft: speelfilm, tv-aflevering, toneelstuk, hoorspel of YouTube-/documentairescript.

Zo'n lang script komt niet goed uit één verzoek, dus de app werkt in stappen:

1. **Outline** – Claude maakt een titel, logline, personagelijst en een indeling in delen van ~2.000 woorden (20.000 woorden = 10 delen).
2. **Deel voor deel schrijven** – elk deel wordt apart geschreven, met de volledige outline en het laatste stuk van de vorige tekst als context, zodat het verhaal doorloopt.
3. **Lengte bewaken** – valt een deel te kort uit, dan vraagt de app om een vervolg. Het woorddoel van de resterende delen wordt steeds bijgesteld, zodat het totaal op ~20.000 uitkomt.

De tekst verschijnt live in de browser; aan het eind kun je hem downloaden als `.txt` en wordt hij ook opgeslagen in `output/`.

## Installeren

Nodig: [Node.js](https://nodejs.org) 18 of nieuwer en een Anthropic API-sleutel (via [console.anthropic.com](https://console.anthropic.com)).

```bash
npm install
```

## Webapp

```bash
ANTHROPIC_API_KEY=sk-ant-... npm start
```

Open daarna <http://localhost:3000>, vul je idee in en klik op **Schrijf script**.

## Commandline

```bash
ANTHROPIC_API_KEY=sk-ant-... npm run cli -- "Een vuurtorenwachter ontdekt dat flessenpost over zijn eigen toekomst gaat" \
  --format film --words 20000 --out vuurtoren.txt
```

Opties: `--format film|serie|toneel|hoorspel|youtube`, `--genre`, `--language` (standaard Nederlands), `--words` (1.000–50.000), `--notes`, `--out`.

## Instellingen

| Variabele | Standaard | Betekenis |
|---|---|---|
| `ANTHROPIC_API_KEY` | – | Je API-sleutel (verplicht) |
| `CLAUDE_MODEL` | `claude-opus-5` | Welk Claude-model schrijft |
| `PORT` | `3000` | Poort van de webapp |

Een script van 20.000 woorden is ongeveer 27.000 uitvoertokens plus denkwerk en duurt, afhankelijk van het model, grofweg 10–20 minuten.

## Tests

```bash
npm test
```

De tests gebruiken een nep-client en roepen de API niet aan.
