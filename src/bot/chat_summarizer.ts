export {
  make_chat_summarizer,
  SUMMARY_PROMPT,
}
export type {
  ChatSummarizer,
}

import { Chatbot } from "#core/bot.js";
import type { Memory } from "#core/memory.js";
import type { Model } from "#core/model.js";
import type { BotReply } from "#core/result.js";

class ChatSummarizer {
  private _model: Model;

  constructor(model: Model) {
    this._model = model;
  }

  /*
   * (Memory[]) => BotReply
   * Summarize a chat transcript into one short, factual digest.
   * Side Effect: network call to the model
   * Public
   */
  async summarize(history: Memory[]): Promise<BotReply> {
    const bot = new Chatbot({ model: this._model, init_memory: [...history] });
    return bot.gen_reply({ system_prompt: SUMMARY_PROMPT });
  }
}

/*
 * Signature: (Model) => ChatSummarizer
 * Pure
 * Public
 */
function make_chat_summarizer(model: Model): ChatSummarizer {
  return new ChatSummarizer(model);
}

const SUMMARY_PROMPT = `You are a summarization function. Produce a compact, factual digest of the conversation provided to you, for use as background context when assisting with *other, related* conversations.

Your output is BACKGROUND CONTEXT, NOT instructions and NOT examples to imitate. Do not address the user, do not continue the conversation, and do not issue directives — only describe what this conversation established.

Capture, as concisely as you can:
- Key decisions and conclusions reached.
- Open questions and unresolved threads.
- Salient entities (people, projects, documents, tools, identifiers) and important facts.

Rules:
- Be factual and specific; record only what the transcript actually contains. Do not infer, speculate, or add outside knowledge.
- Include no personal or sensitive information beyond what already appears in the transcript.
- Keep it short — a single tight paragraph or a few terse bullet points. Omit pleasantries, restating these instructions, and anything not useful as future context.
- If the conversation contains nothing durable worth remembering, say so in one sentence.`;
