import { describe, it } from "node:test";
import * as assert from "node:assert/strict";

import { make_ally } from "#bot/ally.js";
import { MockModel } from "#model/mock.js";
import { ToolRegistry } from "#core/tool.js";
import type { Tool } from "#core/tool.js";
import type { Memory } from "#core/memory.js";
import type { DocumentContext, HistorySource, ProjectContextSource } from "#core/context.js";
import { UpdateSectionTool } from "#tools/document.js";
import { DocumentAuthor, empty_document, type DocumentTemplate } from "common";
import { ALLY_PROMPTS, leaf } from "../support/prompts.ts";

const TEMPLATE: DocumentTemplate = {
  id: "irb-test",
  title: "Test Protocol",
  sections: [{ id: "aims", title: "Specific aims", required: true }],
};

// An empty document from TEMPLATE, as Ally reads it and as the tool writes it.
function document_in_hand(): DocumentContext {
  return {
    template: TEMPLATE,
    guidance: { aims: "The aims." },
    document: empty_document(TEMPLATE, [DocumentAuthor.USER, DocumentAuthor.ASSISTANT]),
  };
}

function history_of(...turns: Memory[]): HistorySource {
  return { load: async () => turns };
}
function no_project(): ProjectContextSource {
  return { load: async () => null };
}
function tool_named(name: string): Tool {
  return {
    name,
    description: `stub ${name}`,
    schema: { properties: {}, required: [] },
    async run() { return { ok: true, value: "" }; },
  };
}

describe("Ally.respond (via MockModel)", () => {
  it("returns the model's reply", async () => {
    const mock = new MockModel({ reply: "ally says hi" });
    const ally = make_ally(mock, ALLY_PROMPTS);
    const reply = await ally.respond(history_of(), no_project(), "hello");
    assert.deepEqual(reply, { ok: true, value: ["ally says hi"] });
  });

  it("generates once, under the Ally system prompt, with history then the live turn last", async () => {
    const mock = new MockModel({ reply: "ok" });
    const ally = make_ally(mock, ALLY_PROMPTS);
    const history = history_of(
      { role: "user", content: "earlier question" },
      { role: "assistant", content: "earlier answer" },
    );

    await ally.respond(history, no_project(), "the new message");

    assert.equal(mock.calls().length, 1);
    const call = mock.calls()[0];
    // Ally's root composed with its default mode reaches the model as the system prompt.
    assert.ok(
      call.opts.system_prompt !== undefined
        && call.opts.system_prompt.startsWith("You are Ally.\n\nBe general."),
      "expected the composed Ally system prompt");
    // Prior turns are replayed, and the live message is the final turn.
    assert.ok(call.memories.some((m) => m.content === "earlier question"));
    assert.deepEqual(
      call.memories[call.memories.length - 1],
      { role: "user", content: "the new message" });
  });

  it("offers its tools to the model when given any", async () => {
    const mock = new MockModel({ reply: "ok" });
    const ally = make_ally(mock, ALLY_PROMPTS, new ToolRegistry([tool_named("kg_search")]));

    await ally.respond(history_of(), no_project(), "hello");

    assert.deepEqual(mock.calls()[0].opts.tools?.map((t) => t.name), ["kg_search"]);
  });

  it("exposes the trace of its last respond", async () => {
    const mock = new MockModel({ reply: "ok" });
    const ally = make_ally(mock, ALLY_PROMPTS);

    await ally.respond(history_of(), no_project(), "hello");

    assert.equal(ally.trace().rounds, 1);
    assert.deepEqual(ally.trace().tool_calls, []);
  });

  it("offers no tools when given none", async () => {
    const mock = new MockModel({ reply: "ok" });

    await make_ally(mock, ALLY_PROMPTS).respond(history_of(), no_project(), "hello");

    assert.equal(mock.calls()[0].opts.tools, undefined);
  });

  it("reads the document it is given each turn, and writes it through the tool it is offered", async () => {
    const mock = new MockModel({
      replies: [
        { calls: [{ name: "update_section", input: { section_id: "aims", content: "1. Measure X" } }] },
        "I've drafted the aims.",
      ],
    });
    const context = document_in_hand();
    const tool = new UpdateSectionTool(context.template, context.document);
    const ally = make_ally(mock, ALLY_PROMPTS, new ToolRegistry([tool]), context);

    const reply = await ally.respond(history_of(), no_project(), "We measure X.");

    assert.deepEqual(reply, { ok: true, value: ["I've drafted the aims."] });
    const system = mock.calls()[0].opts.system_prompt ?? "";
    assert.ok(system.startsWith("You are Ally.\n\nBe general.\n\nThe document being written"));
    assert.ok(system.includes("### Specific aims (id: aims, required)\nBelongs here: The aims.\nNot written yet."));
    assert.equal(tool.document().sections["aims"].text, "1. Measure X");
    assert.equal(tool.document().revision, 1);
  });

  it("composes no document when given none", async () => {
    const mock = new MockModel({ reply: "ok" });

    await make_ally(mock, ALLY_PROMPTS).respond(history_of(), no_project(), "hello");

    assert.ok(!(mock.calls()[0].opts.system_prompt ?? "").includes("The document being written"));
  });
});

describe("make_ally", () => {
  it("refuses prompts that lack the mode Ally starts in", () => {
    const mock = new MockModel({ reply: "ok" });
    assert.throws(() => make_ally(mock, leaf("Ally", "No modes.")), /general/);
  });
});
