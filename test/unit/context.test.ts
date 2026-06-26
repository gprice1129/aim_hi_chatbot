import { describe, it } from "node:test";
import * as assert from "node:assert/strict";

import { ContextAssembler } from "#core/context.js";
import type { Memory } from "#core/memory.js";

// Small explicit budget so truncation/windowing boundaries are easy to assert.
const BUDGET = {
  max_message_chars:    10,
  max_history_messages: 3,
  max_history_chars:    20,
  max_document_chars:   10,
};

function user(content: string): Memory {
  return { role: "user", content };
}

describe("ContextAssembler.clamp_message", () => {
  const a = new ContextAssembler(BUDGET);

  it("returns a message under the cap unchanged", () => {
    assert.equal(a.clamp_message("hello"), "hello");
  });

  it("returns a message exactly at the cap unchanged", () => {
    const msg = "0123456789"; // length 10 == max_message_chars
    assert.equal(a.clamp_message(msg), msg);
  });

  it("truncates an over-cap message and keeps the head", () => {
    const out = a.clamp_message("0123456789ABCDEF");
    assert.ok(out.startsWith("0123456789"));
    assert.ok(out.includes("truncated"));
    assert.ok(out.includes("message"));
  });

  it("returns an empty message unchanged", () => {
    assert.equal(a.clamp_message(""), "");
  });
});

describe("ContextAssembler.clamp_document", () => {
  const a = new ContextAssembler(BUDGET);

  it("returns a document under the cap unchanged", () => {
    assert.equal(a.clamp_document("rfa", "short"), "short");
  });

  it("truncates an over-cap document and names the label in the notice", () => {
    const out = a.clamp_document("rfa", "0123456789ABCDEF");
    assert.ok(out.startsWith("0123456789"));
    assert.ok(out.includes("truncated"));
    assert.ok(out.includes("rfa"));
  });

  it("honors a per-instance budget override", () => {
    const wide = new ContextAssembler({ max_document_chars: 100 });
    const doc = "0123456789ABCDEF"; // 16 chars: over the default-small budget, under 100
    assert.equal(wide.clamp_document("rfa", doc), doc);
  });
});

describe("ContextAssembler.window_history", () => {
  const a = new ContextAssembler(BUDGET);

  it("returns empty for empty input", () => {
    assert.deepEqual(a.window_history([]), []);
  });

  it("returns history under both caps unchanged and in chronological order", () => {
    const history = [user("aa"), user("bb"), user("cc")]; // 3 turns, 6 chars
    assert.deepEqual(a.window_history(history), history);
  });

  it("keeps only the most recent turns when the count cap is exceeded", () => {
    const history = [user("a"), user("b"), user("c"), user("d"), user("e")];
    // max_history_messages == 3 -> keep the last three, chronological.
    assert.deepEqual(a.window_history(history), [user("c"), user("d"), user("e")]);
  });

  it("drops oldest turns when the char cap is exceeded", () => {
    // Each turn is 5 chars; max_history_chars == 20 -> at most four fit.
    // Use a high count cap so only the char cap bites.
    const wide = new ContextAssembler({ ...BUDGET, max_history_messages: 100 });
    const history = ["aaaaa", "bbbbb", "ccccc", "ddddd", "eeeee"].map(user);
    assert.deepEqual(
      wide.window_history(history),
      [user("bbbbb"), user("ccccc"), user("ddddd"), user("eeeee")],
    );
  });

  it("keeps the single most recent turn, clamped, when it alone exceeds the char cap", () => {
    const history = [user("x".repeat(50))];
    const out = a.window_history(history);
    assert.equal(out.length, 1);
    assert.ok(typeof out[0].content === "string" && out[0].content.includes("truncated"));
  });

  it("never collapses to empty: most recent turn survives even when older turns are dropped", () => {
    const history = [user("aa"), user("y".repeat(50))];
    const out = a.window_history(history);
    assert.equal(out.length, 1);
    assert.ok(typeof out[0].content === "string" && out[0].content.startsWith("y"));
  });

  it("does not mutate the input array", () => {
    const history = [user("a"), user("b"), user("c"), user("d")];
    const snapshot = [...history];
    a.window_history(history);
    assert.deepEqual(history, snapshot);
    assert.equal(history.length, 4);
  });

  it("returns a new array, not the input reference", () => {
    const history = [user("a")];
    assert.notEqual(a.window_history(history), history);
  });
});
