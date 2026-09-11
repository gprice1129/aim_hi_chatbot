import { describe, it } from "node:test";
import * as assert from "node:assert/strict";

import { make_chat_summarizer } from "#bot/chat_summarizer.js";
import { MockModel } from "#model/mock.js";
import type { Memory } from "#core/memory.js";
import { SUMMARY_PROMPTS } from "../support/prompts.ts";

describe("ChatSummarizer.summarize (via MockModel)", () => {
  it("returns the model's scripted summary", async () => {
    const mock = new MockModel({ replies: ["a short, factual digest"] });
    const summarizer = make_chat_summarizer(mock, SUMMARY_PROMPTS);
    const reply = await summarizer.summarize([
      { role: "user", content: "let's standardize on postgres" },
      { role: "assistant", content: "agreed, postgres it is" },
    ]);
    assert.deepEqual(reply, { ok: true, value: ["a short, factual digest"] });
  });

  it("sends the whole transcript inside one user turn, under its prompt, in a single call", async () => {
    const mock = new MockModel({ reply: "ok" });
    const summarizer = make_chat_summarizer(mock, SUMMARY_PROMPTS);
    const history: Memory[] = [
      { role: "user", content: "first question" },
      { role: "assistant", content: "first answer" },
      { role: "user", content: "second question" },
    ];

    await summarizer.summarize(history);

    assert.equal(mock.calls().length, 1);
    const call = mock.calls()[0];
    // The summary instruction reaches the model as the system prompt...
    assert.equal(call.opts.system_prompt, SUMMARY_PROMPTS.body);
    // ...and the transcript is one user turn holding every exchange, labeled, in order.
    assert.equal(call.memories.length, 1);
    assert.equal(call.memories[0].role, "user");
    assert.match(
      String(call.memories[0].content),
      /user: first question[\s\S]*assistant: first answer[\s\S]*user: second question/);
  });

  it("asks for the digest as a user turn even when the chat ended with the assistant", async () => {
    // A transcript replayed as turns would end on the assistant's reply, which
    // the model would continue instead of summarize. The model must always be
    // answering a user turn.
    const mock = new MockModel({ reply: "ok" });
    const summarizer = make_chat_summarizer(mock, SUMMARY_PROMPTS);

    await summarizer.summarize([
      { role: "user", content: "a question" },
      { role: "assistant", content: "a complete answer" },
    ]);

    const last = mock.calls()[0].memories.at(-1);
    assert.equal(last?.role, "user");
    assert.ok(String(last?.content).includes("assistant: a complete answer"));
  });

  it("does not carry one chat's transcript into the next call", async () => {
    // One reused summarizer serves many chats out of band; a prior chat's turns
    // must never leak into a later chat's summary (else one user's private
    // conversation lands in another's memory).
    const mock = new MockModel({ reply: "ok" });
    const summarizer = make_chat_summarizer(mock, SUMMARY_PROMPTS);

    await summarizer.summarize([{ role: "user", content: "chat A secret" }]);
    await summarizer.summarize([{ role: "user", content: "chat B" }]);

    // The second call sees only chat B -- not chat A followed by chat B.
    const sent = String(mock.calls()[1].memories[0].content);
    assert.ok(sent.includes("chat B"));
    assert.ok(!sent.includes("chat A secret"));
  });
});
