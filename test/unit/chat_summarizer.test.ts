import { describe, it } from "node:test";
import * as assert from "node:assert/strict";

import { make_chat_summarizer, SUMMARY_PROMPT } from "#bot/chat_summarizer.js";
import { MockModel } from "#model/mock.js";
import type { Memory } from "#core/memory.js";

describe("ChatSummarizer.summarize (via MockModel)", () => {
  it("returns the model's scripted summary", async () => {
    const mock = new MockModel({ replies: ["a short, factual digest"] });
    const summarizer = make_chat_summarizer(mock);
    const reply = await summarizer.summarize([
      { role: "user", content: "let's standardize on postgres" },
      { role: "assistant", content: "agreed, postgres it is" },
    ]);
    assert.deepEqual(reply, { ok: true, value: ["a short, factual digest"] });
  });

  it("composes the whole transcript under SUMMARY_PROMPT in a single call", async () => {
    const mock = new MockModel({ reply: "ok" });
    const summarizer = make_chat_summarizer(mock);
    const history: Memory[] = [
      { role: "user", content: "first question" },
      { role: "assistant", content: "first answer" },
      { role: "user", content: "second question" },
    ];

    await summarizer.summarize(history);

    assert.equal(mock.calls().length, 1);
    const call = mock.calls()[0];
    // The summary instruction reaches the model as the system prompt...
    assert.equal(call.opts.system_prompt, SUMMARY_PROMPT);
    // ...and the full transcript is replayed as the messages, in order.
    assert.deepEqual(call.memories, history);
  });

  it("does not carry one chat's transcript into the next call", async () => {
    // One reused summarizer serves many chats out of band; a prior chat's turns
    // must never leak into a later chat's summary (else one user's private
    // conversation lands in another's memory).
    const mock = new MockModel({ reply: "ok" });
    const summarizer = make_chat_summarizer(mock);

    await summarizer.summarize([{ role: "user", content: "chat A secret" }]);
    await summarizer.summarize([{ role: "user", content: "chat B" }]);

    // The second call sees only chat B -- not chat A followed by chat B.
    assert.deepEqual(mock.calls()[1].memories, [
      { role: "user", content: "chat B" },
    ]);
  });
});
