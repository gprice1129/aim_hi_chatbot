import { describe, it } from "node:test";
import * as assert from "node:assert/strict";

import { ContextAssembler } from "#core/context.js";
import { estimate_tokens } from "#core/tokens.js";
import type { Memory } from "#core/memory.js";
import type {
  HistorySource,
  ProjectContextSource,
  ProjectContext,
} from "#core/context.js";

// Small explicit token budget so truncation/windowing boundaries are easy to
// assert. The estimator is ceil(chars / 4), so 1 token == 4 chars; string
// lengths below are kept as clean multiples of 4.
const BUDGET = {
  max_message_tokens:       3,   // 12 chars
  max_history_messages:     3,
  max_total_context_tokens: 6,   // 24 chars
  max_document_tokens:      3,   // 12 chars
  max_instructions_tokens:  3,   // 12 chars
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

// Total estimated tokens of a string-content message list.
function total_tokens(messages: Memory[]): number {
  return messages.reduce(
    (sum, m) => sum + estimate_tokens(typeof m.content === "string" ? m.content : ""),
    0);
}

describe("ContextAssembler constructor", () => {
  it("accepts a fully positive budget", () => {
    assert.doesNotThrow(() => new ContextAssembler(BUDGET));
  });

  it("throws when a cap is zero", () => {
    assert.throws(() => new ContextAssembler({ max_history_messages: 0 }));
  });

  it("throws when a cap is negative", () => {
    assert.throws(() => new ContextAssembler({ max_document_tokens: -1 }));
  });

  it("throws when the instructions cap is zero", () => {
    assert.throws(() => new ContextAssembler({ max_instructions_tokens: 0 }));
  });

  it("throws when the total-context cap is zero", () => {
    assert.throws(() => new ContextAssembler({ max_total_context_tokens: 0 }));
  });
});

describe("ContextAssembler.clamp_message", () => {
  const a = new ContextAssembler(BUDGET);

  it("returns a message under the cap unchanged", () => {
    assert.equal(a.clamp_message("hello"), "hello"); // 5 chars -> 2 tokens
  });

  it("returns a message exactly at the cap unchanged", () => {
    const msg = "x".repeat(12); // 12 chars == 3 tokens == max_message_tokens
    assert.equal(a.clamp_message(msg), msg);
  });

  it("truncates an over-cap message and keeps the head", () => {
    const out = a.clamp_message("x".repeat(20)); // 5 tokens > 3
    assert.ok(out.startsWith("x".repeat(12)));    // head is 3 tokens of chars
    assert.ok(out.includes("truncated"));
    assert.ok(out.includes("message"));
    assert.ok(out.includes("tokens"));
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
    const out = a.clamp_document("rfa", "x".repeat(20));
    assert.ok(out.startsWith("x".repeat(12)));
    assert.ok(out.includes("truncated"));
    assert.ok(out.includes("rfa"));
  });

  it("honors a per-instance budget override", () => {
    const wide = new ContextAssembler({ max_document_tokens: 100 });
    const doc = "x".repeat(64); // 16 tokens: over the small budget, under 100
    assert.equal(wide.clamp_document("rfa", doc), doc);
  });
});

describe("ContextAssembler.window_history", () => {
  const a = new ContextAssembler(BUDGET);

  it("returns empty for empty input", () => {
    assert.deepEqual(a.window_history([]), []);
  });

  it("returns history under both caps unchanged and in chronological order", () => {
    const history = [user("aa"), user("bb"), user("cc")]; // 3 turns, 1 token each
    assert.deepEqual(a.window_history(history), history);
  });

  it("keeps only the most recent turns when the count cap is exceeded", () => {
    const history = [user("a"), user("b"), user("c"), user("d"), user("e")];
    // max_history_messages == 3 -> keep the last three, chronological.
    assert.deepEqual(a.window_history(history), [user("c"), user("d"), user("e")]);
  });

  it("drops oldest turns when the token budget is exceeded", () => {
    // Each turn is 8 chars == 2 tokens; budget is 6 tokens -> at most three fit.
    // Use a high count cap so only the token budget bites.
    const wide = new ContextAssembler({ ...BUDGET, max_history_messages: 100 });
    const history = ["a", "b", "c", "d", "e"].map((ch) => user(ch.repeat(8)));
    assert.deepEqual(
      wide.window_history(history),
      [user("c".repeat(8)), user("d".repeat(8)), user("e".repeat(8))],
    );
  });

  it("keeps the single most recent turn, clamped, when it alone exceeds the budget", () => {
    const history = [user("x".repeat(40))]; // 10 tokens > 6
    const out = a.window_history(history);
    assert.equal(out.length, 1);
    assert.ok(typeof out[0].content === "string" && out[0].content.includes("truncated"));
  });

  it("never collapses to empty: most recent turn survives even when older turns are dropped", () => {
    const history = [user("aa"), user("y".repeat(40))];
    const out = a.window_history(history);
    assert.equal(out.length, 1);
    assert.ok(typeof out[0].content === "string" && out[0].content.startsWith("y"));
  });

  it("honors an explicit token budget argument", () => {
    const wide = new ContextAssembler({ ...BUDGET, max_history_messages: 100 });
    const history = ["a", "b", "c", "d"].map((ch) => user(ch.repeat(8))); // 2 tokens each
    // Budget of 4 tokens -> only the last two (4 tokens) fit.
    assert.deepEqual(
      wide.window_history(history, 4),
      [user("c".repeat(8)), user("d".repeat(8))],
    );
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
    const out = await new ContextAssembler({ max_instructions_tokens: 3 }).assemble({
      system_prompt: "BASE",
      project: project_of({ instructions: "z".repeat(40), memory: [] }),
    });
    assert.ok(out.system.includes("truncated"));
    assert.ok(out.system.includes("instructions")); // the clamp label
    // Bounded: only the 3-token (12-char) head of the instructions survives.
    assert.equal((out.system.match(/z/g) ?? []).length, 12);
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
      message: user("x".repeat(20)), // 5 tokens > max_message_tokens (3)
    });
    assert.equal(out.messages.length, 1);
    const content = out.messages[0].content;
    assert.ok(typeof content === "string");
    assert.ok(content.startsWith("x".repeat(12)));
    assert.ok(content.includes("truncated"));
    assert.ok(content.includes("message"));
  });

  it("windows project memory through the count cap", async () => {
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

  // --- Unified-budget priority (Phase C) ---------------------------------------

  it("drops project memory, not history, when the budget is full", async () => {
    // budget 10 tokens; history alone fills it, memory then gets nothing.
    const a = new ContextAssembler({
      max_message_tokens: 100,
      max_history_messages: 100,
      max_total_context_tokens: 10,
      max_document_tokens: 100,
      max_instructions_tokens: 100,
    });
    const out = await a.assemble({
      system_prompt: "BASE",
      project: project_of({ instructions: null, memory: [user("m".repeat(40))] }), // 10 tokens
      history: history_of(user("h".repeat(40))),                                   // 10 tokens
    });
    // History retained whole; the cross-chat memory turn is dropped entirely.
    assert.equal(out.messages.length, 1);
    assert.equal(out.messages[0].content, "h".repeat(40));
    assert.ok(!out.messages.some(
      (m) => typeof m.content === "string" && m.content.startsWith("m")));
  });

  it("always includes the live turn, clamped, even alongside history and memory", async () => {
    const a = new ContextAssembler({
      max_message_tokens: 3,
      max_history_messages: 100,
      max_total_context_tokens: 100,
      max_document_tokens: 100,
      max_instructions_tokens: 100,
    });
    const out = await a.assemble({
      system_prompt: "BASE",
      project: project_of({ instructions: null, memory: [user("m1")] }),
      history: history_of(user("h1")),
      message: user("x".repeat(40)), // 10 tokens > max_message_tokens (3)
    });
    const last = out.messages[out.messages.length - 1];
    assert.ok(typeof last.content === "string");
    assert.ok(last.content.startsWith("x".repeat(12))); // clamped to 3 tokens
    assert.ok(last.content.includes("truncated"));
    assert.ok(out.messages.some((m) => m.content === "m1"));
    assert.ok(out.messages.some((m) => m.content === "h1"));
  });

  it("keeps the live turn even when the total budget is tiny", async () => {
    const a = new ContextAssembler({
      max_message_tokens: 3,
      max_history_messages: 100,
      max_total_context_tokens: 1,
      max_document_tokens: 100,
      max_instructions_tokens: 100,
    });
    const out = await a.assemble({
      system_prompt: "BASE",
      message: user("hi"), // 1 token, under the message cap -> unchanged
    });
    assert.deepEqual(out.messages, [user("hi")]);
  });

  it("keeps total replayed context within the unified budget (uniform turns)", async () => {
    const budget = 10;
    const a = new ContextAssembler({
      max_message_tokens: 100,
      max_history_messages: 100,
      max_total_context_tokens: budget,
      max_document_tokens: 100,
      max_instructions_tokens: 100,
    });
    const history = Array.from({ length: 20 }, () => user("aaaa")); // 1 token each
    const out = await a.assemble({
      system_prompt: "BASE",
      history: history_of(...history),
      message: user("bbbb"), // 1 token live turn
    });
    // Old behavior windowed memory and history independently (~2x); the unified
    // budget keeps the live turn + history within a single cap.
    assert.ok(total_tokens(out.messages) <= budget);
    assert.ok(out.messages.length < history.length + 1); // some oldest dropped
  });
});
