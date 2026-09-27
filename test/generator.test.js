import { test } from "node:test";
import assert from "node:assert/strict";
import { generateScript, countWords } from "../src/generator.js";

// Minimal stand-in for client.beta.messages.stream: returns an outline for the
// JSON-schema request and a fixed amount of text for every section request.
function fakeClient({ wordsPerCall }) {
  const calls = [];
  return {
    calls,
    beta: {
      messages: {
        stream(params) {
          calls.push(params);
          const isOutline = params.output_config?.format?.type === "json_schema";
          const text = isOutline
            ? JSON.stringify({
                title: "De Vuurtoren",
                logline: "Een wachter leest zijn toekomst.",
                characters: [{ name: "JAN", description: "vuurtorenwachter" }],
                sections: Array.from({ length: 10 }, (_, i) => ({ title: `Deel ${i + 1}`, summary: "..." })),
              })
            : Array(wordsPerCall).fill("woord").join(" ");
          const message = { stop_reason: "end_turn", content: [{ type: "text", text }] };
          return {
            async *[Symbol.asyncIterator]() {
              yield { type: "content_block_delta", delta: { type: "text_delta", text } };
            },
            finalMessage: async () => message,
          };
        },
      },
    },
  };
}

async function run(client, opts) {
  const events = [];
  for await (const ev of generateScript(opts, { client })) events.push(ev);
  return events;
}

test("writes all sections and reaches the target length", async () => {
  const client = fakeClient({ wordsPerCall: 2000 });
  const events = await run(client, { premise: "vuurtoren", targetWords: 20000 });
  const done = events.at(-1);
  assert.equal(done.type, "done");
  assert.ok(done.words >= 20000, `got ${done.words}`);
  assert.equal(events.filter((e) => e.type === "section_done").length, 10);
  assert.equal(client.calls.length, 11); // outline + 10 sections
});

test("asks for a continuation when a section is too short", async () => {
  const client = fakeClient({ wordsPerCall: 1000 });
  const events = await run(client, { premise: "vuurtoren", targetWords: 20000 });
  assert.ok(events.at(-1).words >= 18000, `got ${events.at(-1).words}`);
  assert.ok(client.calls.length > 11);
});

test("rejects an empty premise", async () => {
  await assert.rejects(run(fakeClient({ wordsPerCall: 10 }), { premise: "  " }), /premisse/);
});

test("countWords", () => {
  assert.equal(countWords("  een twee\ndrie "), 3);
  assert.equal(countWords(""), 0);
});
