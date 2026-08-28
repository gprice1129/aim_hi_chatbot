import { describe, it } from "node:test";
import * as assert from "node:assert/strict";

import { Chatbot } from "#core/bot.js";
import { MockModel } from "#model/mock.js";
import { ToolRegistry, ToolParamType } from "#core/tool.js";
import { BotFailure } from "#core/result.js";
import type { Tool, ToolInput, ToolOutcome } from "#core/tool.js";
import type { Memory } from "#core/memory.js";

// A tool that records what it was called with so the loop can be assert what
// the model asked for and what the bot ran.
function recorder(name: string, value = "tool output"): Tool & { seen: ToolInput[] } {
  const seen: ToolInput[] = [];
  return {
    name,
    description: `records calls to ${name}`,
    schema: {
      properties: { q: { type: ToolParamType.String, description: "a query" } },
      required: ["q"],
    },
    seen,
    async run(input: ToolInput): Promise<ToolOutcome> {
      seen.push(input);
      return { ok: true, value };
    },
  };
}

// Content blocks of a memory, for asserting the replayed transcript.
function blocks(memory: Memory): any[] {
  return Array.isArray(memory.content) ? memory.content as any[] : [];
}

describe("Chatbot tool loop", () => {
  it("runs a requested tool and returns the reply that follows it", async () => {
    const tool = recorder("kg_search", '{"hits":[{"id":"whisper"}]}');
    const model = new MockModel({
      replies: [
        { calls: [{ name: "kg_search", input: { q: "transcription" } }] },
        "Whisper runs locally.",
      ],
    });
    const bot = new Chatbot({ model, tools: new ToolRegistry([tool]) });

    const reply = await bot.gen_reply({});

    assert.deepEqual(reply, { ok: true, value: ["Whisper runs locally."] });
    assert.deepEqual(tool.seen, [{ q: "transcription" }]);
    assert.equal(model.calls().length, 2);
  });

  it("offers its tools to the model on every call", async () => {
    const model = new MockModel({
      replies: [{ calls: [{ name: "kg_search", input: { q: "x" } }] }, "done"],
    });
    const bot = new Chatbot({ model, tools: new ToolRegistry([recorder("kg_search")]) });

    await bot.gen_reply({ system_prompt: "be brief" });

    for (const call of model.calls()) {
      assert.deepEqual(call.opts.tools?.map((t) => t.name), ["kg_search"]);
      // Tools ride alongside the caller's opts rather than replacing them.
      assert.equal(call.opts.system_prompt, "be brief");
    }
  });

  it("replays the tool request and its results back to the model", async () => {
    const model = new MockModel({
      replies: [{ calls: [{ name: "kg_search", input: { q: "phi" } }] }, "done"],
    });
    const bot = new Chatbot({ model, tools: new ToolRegistry([recorder("kg_search", "RESULT")]) });

    await bot.gen_reply({});

    // The provider requires its own tool_use block in the transcript before it
    // will accept the tool_result answering it.
    const second = model.calls()[1].memories;
    assert.equal(second.length, 2);
    assert.equal(second[0].role, "assistant");
    const request = blocks(second[0])[0];
    assert.equal(request.type, "tool_use");
    assert.equal(request.name, "kg_search");
    assert.equal(second[1].role, "user");
    const result = blocks(second[1])[0];
    assert.equal(result.type, "tool_result");
    assert.equal(result.tool_use_id, request.id);
    assert.equal(result.content, "RESULT");
    assert.equal("is_error" in result, false);
  });

  it("hands a failed tool call back to the model as an error result", async () => {
    const model = new MockModel({
      replies: [{ calls: [{ name: "kg_serch", input: {} }] }, "recovered"],
    });
    const bot = new Chatbot({ model, tools: new ToolRegistry([recorder("kg_search")]) });

    const reply = await bot.gen_reply({});

    // A wrong tool name costs a turn, not the conversation.
    assert.deepEqual(reply, { ok: true, value: ["recovered"] });
    const result = blocks(model.calls()[1].memories[1])[0];
    assert.equal(result.is_error, true);
    assert.match(result.content, /Unknown tool 'kg_serch'/);
  });

  it("runs several tools requested in one turn", async () => {
    const search = recorder("kg_search", "hits");
    const get = recorder("kg_get", "nodes");
    const model = new MockModel({
      replies: [
        { calls: [{ name: "kg_search", input: { q: "a" } }, { name: "kg_get", input: { q: "b" } }] },
        "done",
      ],
    });
    const bot = new Chatbot({ model, tools: new ToolRegistry([search, get]) });

    await bot.gen_reply({});

    assert.deepEqual(search.seen, [{ q: "a" }]);
    assert.deepEqual(get.seen, [{ q: "b" }]);
    const results = blocks(model.calls()[1].memories[1]);
    assert.equal(results.length, 2);
    assert.deepEqual(results.map((r) => r.content), ["hits", "nodes"]);
  });

  it("loops until the model stops asking for tools", async () => {
    const tool = recorder("kg_search");
    const model = new MockModel({
      replies: [
        { calls: [{ name: "kg_search", input: { q: "1" } }] },
        { calls: [{ name: "kg_search", input: { q: "2" } }] },
        { calls: [{ name: "kg_search", input: { q: "3" } }] },
        "answer",
      ],
    });
    const bot = new Chatbot({ model, tools: new ToolRegistry([tool]) });

    const reply = await bot.gen_reply({});

    assert.deepEqual(reply, { ok: true, value: ["answer"] });
    assert.deepEqual(tool.seen.map((i) => i["q"]), ["1", "2", "3"]);
  });

  it("gives up once a model exceeds the tool round cap", async () => {
    const tool = recorder("kg_search");
    // Never stops asking: the fallback reply is a tool request too.
    const model = new MockModel({
      replies: Array.from({ length: 10 },
        () => ({ calls: [{ name: "kg_search", input: { q: "again" } }] })),
    });
    const bot = new Chatbot({ model, tools: new ToolRegistry([tool]), max_tool_rounds: 2 });

    const reply = await bot.gen_reply({});

    assert.deepEqual(reply, { ok: false, error: { failure: BotFailure.TOOL_LIMIT } });
    // Two rounds executed, and the third request is what trips the cap.
    assert.equal(tool.seen.length, 2);
    assert.equal(model.calls().length, 3);
  });

  it("treats a tool request naming no tools as an incomplete turn", async () => {
    const model = new MockModel({ replies: [{ calls: [] }] });
    const bot = new Chatbot({ model, tools: new ToolRegistry([recorder("kg_search")]) });

    const reply = await bot.gen_reply({});

    // Replaying it would ask the same question forever.
    assert.deepEqual(reply, { ok: false, error: { failure: BotFailure.INCOMPLETE } });
    assert.equal(model.calls().length, 1);
  });

  it("leaves a bot with no tools exactly as it was", async () => {
    const model = new MockModel({ reply: "plain reply" });
    const bot = new Chatbot({ model });

    const reply = await bot.gen_reply({ system_prompt: "hello" });

    assert.deepEqual(reply, { ok: true, value: ["plain reply"] });
    assert.equal(model.calls().length, 1);
    assert.equal(model.calls()[0].opts.tools, undefined);
    assert.equal(bot.tools(), null);
  });

  it("traces the rounds, the tool calls and their outcomes", async () => {
    const model = new MockModel({
      replies: [{ calls: [{ name: "kg_search", input: { q: "phi" } }] }, "done"],
    });
    const bot = new Chatbot({ model, tools: new ToolRegistry([recorder("kg_search", "RESULT")]) });

    await bot.gen_reply({});

    const trace = bot.trace();
    assert.equal(trace.rounds, 2);
    assert.deepEqual(trace.tool_calls, [
      { round: 0, name: "kg_search", input: { q: "phi" }, ok: true, result: "RESULT" },
    ]);
    // The mock reports zero tokens; the point is that usage is summed at all.
    assert.deepEqual(trace.usage, { input_tokens: 0, output_tokens: 0 });
  });

  it("traces a failed tool call with its error, and a plain reply with none", async () => {
    const model = new MockModel({
      replies: [{ calls: [{ name: "kg_serch", input: {} }] }, "recovered", "plain"],
    });
    const bot = new Chatbot({ model, tools: new ToolRegistry([recorder("kg_search")]) });

    await bot.gen_reply({});
    const failed = bot.trace();
    assert.equal(failed.tool_calls[0].ok, false);
    assert.match(failed.tool_calls[0].result, /Unknown tool 'kg_serch'/);

    // Each reply starts a fresh trace.
    await bot.gen_reply({});
    assert.deepEqual(bot.trace(), {
      rounds: 1, tool_calls: [], usage: { input_tokens: 0, output_tokens: 0 },
    });
  });

  it("classifies a provider error during a tool loop as unavailable", async () => {
    const model = new MockModel({
      replies: [{ calls: [{ name: "kg_search", input: { q: "x" } }] }],
    });
    const failing = {
      ...model,
      str_to_memory: model.str_to_memory.bind(model),
      wants_tools: model.wants_tools.bind(model),
      extract_content: model.extract_content.bind(model),
      extract_tool_calls: model.extract_tool_calls.bind(model),
      msg_to_memory: model.msg_to_memory.bind(model),
      tool_results_to_memory: model.tool_results_to_memory.bind(model),
      gen_message: async (memories: Memory[], opts: any) => {
        if (memories.length > 0) throw new Error("429 rate limited");
        return model.gen_message(memories, opts);
      },
    };
    const bot = new Chatbot({ model: failing, tools: new ToolRegistry([recorder("kg_search")]) });

    const reply = await bot.gen_reply({});

    assert.equal(reply.ok, false);
    assert.equal(reply.ok ? null : reply.error.failure, BotFailure.UNAVAILABLE);
  });
});
