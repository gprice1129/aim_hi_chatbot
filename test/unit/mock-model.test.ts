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

  it("streams each turn's text, prefaces included, and rejects once aborted", async () => {
    const m = new MockModel({ replies: [{ text: "preface", calls: [{ name: "t" }] }, "answer"] });
    const seen: string[] = [];
    const tool_turn = await m.gen_message([], { stream: { on_delta: (text) => seen.push(text), abort_signal: new AbortController().signal } });
    await m.gen_message([], { stream: { on_delta: (text) => seen.push(text), abort_signal: new AbortController().signal } });
    assert.deepEqual(seen, ["preface", "answer"]);
    assert.deepEqual(tool_turn.content[0], { type: "text", text: "preface", citations: null });

    const controller = new AbortController();
    controller.abort();
    await assert.rejects(m.gen_message([], { stream: { on_delta: () => {}, abort_signal: controller.signal } }), { name: "AbortError" });
  });
});

describe("MockModel streamed turns", () => {
  it("delivers a turn scripted in pieces one piece at a time", async () => {
    const m = new MockModel({ replies: [{ deltas: ["one ", "two"] }] });
    const seen: string[] = [];
    const msg = await m.gen_message([], { stream: {
      on_delta: (text) => seen.push(text), abort_signal: new AbortController().signal,
    } });
    assert.deepEqual(seen, ["one ", "two"]);
    assert.deepEqual(m.extract_content(msg), ["one two"]);
  });

  it("rejects mid-turn once aborted, delivering nothing further", async () => {
    const m = new MockModel({ replies: [{ deltas: ["one ", "two ", "three"] }] });
    const controller = new AbortController();
    const seen: string[] = [];
    await assert.rejects(
      m.gen_message([], { stream: {
        on_delta: (text) => { seen.push(text); controller.abort(); },
        abort_signal: controller.signal,
      } }),
      { name: "AbortError" });
    assert.deepEqual(seen, ["one "]);
  });
});
