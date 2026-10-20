import { describe, it } from "node:test";
import * as assert from "node:assert/strict";

import { make_document_builder, DEFAULT_OPENING_TURN } from "#bot/document_builder.js";
import { MockModel } from "#model/mock.js";
import { SectionStatus, empty_document } from "#core/document.js";
import type { Tool } from "#core/tool.js";
import type { Memory } from "#core/memory.js";
import type { HistorySource } from "#core/context.js";
import { DOCUMENT_BUILDER_PROMPTS, IRB_TEMPLATE, leaf } from "../support/prompts.ts";

const NOW = "2026-10-20T00:00:00.000Z";

function history_of(...turns: Memory[]): HistorySource {
  return { load: async () => turns };
}

function stub_tool(name: string): Tool {
  return {
    name,
    description: `stub ${name}`,
    schema: { properties: {}, required: [] },
    async run() { return { ok: true, value: "" }; },
  };
}

describe("DocumentBuilder.respond (via MockModel)", () => {
  it("composes the template guidance and the current document into the system prompt", async () => {
    const mock = new MockModel({ reply: "What is the title?" });
    const doc = empty_document(IRB_TEMPLATE, NOW);
    const builder = make_document_builder(mock, DOCUMENT_BUILDER_PROMPTS, IRB_TEMPLATE, doc);

    const reply = await builder.respond(history_of(), "hello");

    assert.deepEqual(reply, { ok: true, value: ["What is the title?"] });
    const system = mock.calls()[0].opts.system_prompt ?? "";
    assert.match(system, /^Interview the user\./);
    assert.match(system, /TEMPLATE:\n# Test Protocol/);
    assert.match(system, /DOCUMENT:\n### Specific aims \(id: aims\)\nStatus: empty/);
    assert.deepEqual(mock.calls()[0].memories.at(-1), { role: "user", content: "hello" });
  });

  it("opens with the prompt's opening turn when there is no message", async () => {
    const mock = new MockModel({ reply: "Hi! Let's begin." });
    const builder = make_document_builder(
      mock, DOCUMENT_BUILDER_PROMPTS, IRB_TEMPLATE, empty_document(IRB_TEMPLATE, NOW));

    await builder.respond(history_of(), null);

    assert.deepEqual(mock.calls()[0].memories, [{ role: "user", content: "Begin the interview." }]);
  });

  it("falls back to a default opener when the prompt declares none", async () => {
    const mock = new MockModel({ reply: "ok" });
    const prompts = leaf("Builder", "{templateGuidance}\n{documentState}");
    const builder = make_document_builder(mock, prompts, IRB_TEMPLATE, empty_document(IRB_TEMPLATE, NOW));

    await builder.respond(history_of(), null);

    assert.deepEqual(mock.calls()[0].memories, [{ role: "user", content: DEFAULT_OPENING_TURN }]);
  });

  it("writes the document through update_section and reports what changed", async () => {
    const mock = new MockModel({
      replies: [
        { text: "Noted.", calls: [{ name: "update_section", input: { section_id: "aims", content: "1. Measure X", status: "complete" } }] },
        "I've drafted the aims. Next, the population?",
      ],
    });
    const builder = make_document_builder(
      mock, DOCUMENT_BUILDER_PROMPTS, IRB_TEMPLATE, empty_document(IRB_TEMPLATE, NOW), [], () => "t1");

    const reply = await builder.respond(history_of(), "We measure X.");

    assert.deepEqual(reply, { ok: true, value: ["I've drafted the aims. Next, the population?"] });
    assert.equal(builder.document().sections.aims.content, "1. Measure X");
    assert.equal(builder.document().sections.aims.status, SectionStatus.COMPLETE);
    assert.equal(builder.document().sections.aims.updated_at, "t1");
    assert.deepEqual(builder.changed_sections(), ["aims"]);
    assert.equal(builder.tool_rounds().length, 1);
    assert.equal(builder.tool_rounds()[0].calls[0].ok, true);
  });

  it("offers extra tools beside update_section", async () => {
    const mock = new MockModel({ reply: "ok" });
    const builder = make_document_builder(
      mock, DOCUMENT_BUILDER_PROMPTS, IRB_TEMPLATE, empty_document(IRB_TEMPLATE, NOW),
      [stub_tool("kg_search"), stub_tool("kg_get")]);

    await builder.respond(history_of(), "hi");

    assert.deepEqual(mock.calls()[0].opts.tools?.map((t) => t.name), ["kg_search", "kg_get", "update_section"]);
  });

  it("replays history before the live turn", async () => {
    const mock = new MockModel({ reply: "ok" });
    const builder = make_document_builder(
      mock, DOCUMENT_BUILDER_PROMPTS, IRB_TEMPLATE, empty_document(IRB_TEMPLATE, NOW));

    await builder.respond(history_of(
      { role: "user", content: "earlier" }, { role: "assistant", content: "answer" }), "now");

    const memories = mock.calls()[0].memories;
    assert.equal(memories[0].content, "earlier");
    assert.deepEqual(memories.at(-1), { role: "user", content: "now" });
  });
});
