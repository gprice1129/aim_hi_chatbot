import { describe, it } from "node:test";
import * as assert from "node:assert/strict";

import { ContextAssembler } from "#core/context.js";
import type { Memory } from "#core/memory.js";
import type {
  HistorySource,
  ProjectContextSource,
  ProjectContext,
} from "#core/context.js";

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

function assistant(content: string): Memory {
  return { role: "assistant", content };
}

// In-memory fake ports so assemble() can be exercised without any I/O.
function history_of(...turns: Memory[]): HistorySource {
  return { load: async () => turns };
}

function project_of(ctx: ProjectContext | null): ProjectContextSource {
  return { load: async () => ctx };
}

// Mirrors core's static precedence frame so tests pin its exact, cache-stable
// text; assemble() composes it as `${base}\n\n${frame(instructions)}`.
function fenced(base: string, instructions: string): string {
  return [
    base,
    "",
    "The user has provided the following project instructions.",
    "Follow them unless they conflict with anything above; on any conflict the instructions",
    "above take precedence and the conflicting project instruction is ignored.",
    "",
    instructions,
  ].join("\n");
}

describe("ContextAssembler constructor", () => {
  it("accepts a fully positive budget", () => {
    assert.doesNotThrow(() => new ContextAssembler(BUDGET));
  });

  it("throws when a cap is zero", () => {
    assert.throws(() => new ContextAssembler({ max_history_messages: 0 }));
  });

  it("throws when a cap is negative", () => {
    assert.throws(() => new ContextAssembler({ max_document_chars: -1 }));
  });

  it("throws when the instructions cap is zero", () => {
    assert.throws(() => new ContextAssembler({ max_instructions_chars: 0 }));
  });
});

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

describe("ContextAssembler.assemble", () => {
  it("returns just the base prompt and no messages when given no sources", async () => {
    const out = await new ContextAssembler().assemble({ system_prompt: "BASE" });
    assert.equal(out.system, "BASE");
    assert.deepEqual(out.messages, []);
  });

  it("replays history into messages, in order, without touching the system prompt", async () => {
    const out = await new ContextAssembler().assemble({
      system_prompt: "BASE",
      history: history_of(user("h1"), assistant("h2")),
    });
    assert.equal(out.system, "BASE");
    assert.deepEqual(out.messages, [user("h1"), assistant("h2")]);
  });

  it("frames project instructions and appends them after the base prompt", async () => {
    const out = await new ContextAssembler().assemble({
      system_prompt: "BASE",
      project: project_of({ instructions: "PROJECT RULES", memory: [] }),
    });
    // Base prompt first, then the static precedence frame wrapping the instructions.
    assert.equal(out.system, fenced("BASE", "PROJECT RULES"));
    assert.ok(out.system.startsWith("BASE\n\n"));
    assert.ok(out.system.includes("take precedence"));
    assert.ok(out.system.endsWith("PROJECT RULES"));
    assert.deepEqual(out.messages, []);
  });

  it("leaves the system prompt untouched when the chat is in no project", async () => {
    const out = await new ContextAssembler().assemble({
      system_prompt: "BASE",
      project: project_of(null),
    });
    assert.equal(out.system, "BASE");
    assert.deepEqual(out.messages, []);
  });

  it("leaves the system prompt untouched when the project sets no instructions", async () => {
    const out = await new ContextAssembler().assemble({
      system_prompt: "BASE",
      project: project_of({ instructions: null, memory: [user("m")] }),
    });
    assert.equal(out.system, "BASE");
    assert.ok(!out.system.includes("take precedence")); // no fence when null
    assert.deepEqual(out.messages, [user("m")]);
  });

  it("clamps oversized project instructions, keeping the head and noting truncation", async () => {
    const out = await new ContextAssembler({ max_instructions_chars: 10 }).assemble({
      system_prompt: "BASE",
      project: project_of({ instructions: "z".repeat(50), memory: [] }),
    });
    assert.ok(out.system.includes("truncated"));
    assert.ok(out.system.includes("instructions")); // the clamp label
    // Bounded: only the 10-char head of the instructions survives the clamp.
    assert.equal((out.system.match(/z/g) ?? []).length, 10);
  });

  it("orders messages as project memory, then history, then the live turn", async () => {
    const out = await new ContextAssembler().assemble({
      system_prompt: "BASE",
      project: project_of({ instructions: "PROJ", memory: [user("m1"), assistant("m2")] }),
      history: history_of(user("h1"), assistant("h2")),
      message: user("live"),
    });
    assert.equal(out.system, fenced("BASE", "PROJ"));
    assert.deepEqual(out.messages, [
      user("m1"), assistant("m2"),
      user("h1"), assistant("h2"),
      user("live"),
    ]);
  });

  it("places the live turn last even with no history or project", async () => {
    const out = await new ContextAssembler().assemble({
      system_prompt: "BASE",
      message: user("hi"),
    });
    assert.deepEqual(out.messages, [user("hi")]);
  });

  it("clamps an oversized live turn to the message budget", async () => {
    const out = await new ContextAssembler(BUDGET).assemble({
      system_prompt: "BASE",
      message: user("x".repeat(20)), // > max_message_chars (10)
    });
    assert.equal(out.messages.length, 1);
    const content = out.messages[0].content;
    assert.ok(typeof content === "string");
    assert.ok(content.startsWith("xxxxxxxxxx"));
    assert.ok(content.includes("truncated"));
    assert.ok(content.includes("message"));
  });

  it("windows project memory through the budget", async () => {
    const out = await new ContextAssembler(BUDGET).assemble({
      system_prompt: "BASE",
      project: project_of({
        instructions: null,
        memory: [user("a"), user("b"), user("c"), user("d"), user("e")],
      }),
    });
    // max_history_messages == 3 -> only the most recent three survive.
    assert.deepEqual(out.messages, [user("c"), user("d"), user("e")]);
  });
});
