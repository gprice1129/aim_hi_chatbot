import { describe, it } from "node:test";
import * as assert from "node:assert/strict";

import { MockModel } from "#model/mock.js";

describe("MockModel", () => {
  it("returns the default canned reply and extracts its text", async () => {
    const m = new MockModel();
    const msg = await m.gen_message([{ role: "user", content: "hi" }], {});
    assert.equal(msg.stop_reason, "end_turn");
    assert.deepEqual(m.extract_content(msg), ["[mock-llm] canned reply"]);
  });

  it("returns a custom fixed reply", async () => {
    const m = new MockModel({ reply: "hello there" });
    const msg = await m.gen_message([], {});
    assert.deepEqual(m.extract_content(msg), ["hello there"]);
  });

  it("consumes scripted replies in order, then falls back to reply", async () => {
    const m = new MockModel({ reply: "fallback", replies: ["one", "two"] });
    assert.deepEqual(m.extract_content(await m.gen_message([], {})), ["one"]);
    assert.deepEqual(m.extract_content(await m.gen_message([], {})), ["two"]);
    assert.deepEqual(m.extract_content(await m.gen_message([], {})), ["fallback"]);
  });

  it("records each call's memories and opts", async () => {
    const m = new MockModel();
    await m.gen_message([{ role: "user", content: "x" }], { system_prompt: "SYS" });
    await m.gen_message([{ role: "user", content: "y" }], {});
    assert.equal(m.calls().length, 2);
    assert.deepEqual(m.calls()[0].memories, [{ role: "user", content: "x" }]);
    assert.equal(m.calls()[0].opts.system_prompt, "SYS");
    assert.deepEqual(m.calls()[1].memories, [{ role: "user", content: "y" }]);
  });

  it("str_to_memory builds a user memory", () => {
    const m = new MockModel();
    assert.deepEqual(m.str_to_memory("hi"), { role: "user", content: "hi" });
  });

  it("produces a well-formed assistant message with zeroed usage", async () => {
    const m = new MockModel();
    const msg = await m.gen_message([], {});
    assert.equal(msg.type, "message");
    assert.equal(msg.role, "assistant");
    assert.equal(msg.usage.input_tokens, 0);
    assert.equal(msg.usage.output_tokens, 0);
  });
});
