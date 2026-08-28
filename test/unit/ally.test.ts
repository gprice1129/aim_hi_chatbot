import { describe, it } from "node:test";
import * as assert from "node:assert/strict";

import { make_ally } from "#bot/ally.js";
import { MockModel } from "#model/mock.js";
import { ToolRegistry } from "#core/tool.js";
import type { Tool } from "#core/tool.js";
import type { Memory } from "#core/memory.js";
import type { HistorySource, ProjectContextSource } from "#core/context.js";

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
    const ally = make_ally(mock);
    const reply = await ally.respond(history_of(), no_project(), "hello");
    assert.deepEqual(reply, { ok: true, value: ["ally says hi"] });
  });

  it("generates once, under the Ally system prompt, with history then the live turn last", async () => {
    const mock = new MockModel({ reply: "ok" });
    const ally = make_ally(mock);
    const history = history_of(
      { role: "user", content: "earlier question" },
      { role: "assistant", content: "earlier answer" },
    );

    await ally.respond(history, no_project(), "the new message");

    assert.equal(mock.calls().length, 1);
    const call = mock.calls()[0];
    // Ally's persona reaches the model as the system prompt.
    assert.ok(
      call.opts.system_prompt !== undefined
        && call.opts.system_prompt.includes("You are Ally"),
      "expected the Ally system prompt");
    // Prior turns are replayed, and the live message is the final turn.
    assert.ok(call.memories.some((m) => m.content === "earlier question"));
    assert.deepEqual(
      call.memories[call.memories.length - 1],
      { role: "user", content: "the new message" });
  });

  it("offers its tools to the model when given any", async () => {
    const mock = new MockModel({ reply: "ok" });
    const ally = make_ally(mock, new ToolRegistry([tool_named("kg_search")]));

    await ally.respond(history_of(), no_project(), "hello");

    assert.deepEqual(mock.calls()[0].opts.tools?.map((t) => t.name), ["kg_search"]);
  });

  it("exposes the trace of its last respond", async () => {
    const mock = new MockModel({ reply: "ok" });
    const ally = make_ally(mock);

    await ally.respond(history_of(), no_project(), "hello");

    assert.equal(ally.trace().rounds, 1);
    assert.deepEqual(ally.trace().tool_calls, []);
  });

  it("offers no tools when given none", async () => {
    const mock = new MockModel({ reply: "ok" });

    await make_ally(mock).respond(history_of(), no_project(), "hello");

    assert.equal(mock.calls()[0].opts.tools, undefined);
  });
});
