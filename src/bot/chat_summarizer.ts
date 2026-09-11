export {
  make_chat_summarizer,
  CHAT_SUMMARY_MODES,
}
export type {
  ChatSummarizer,
}

import { Chatbot } from "#core/bot.js";
import type { Memory } from "#core/memory.js";
import type { Model } from "#core/model.js";
import type { BotReply } from "#core/result.js";
import { compose_prompt, type PromptNode } from "#prompts/prompt_tree.js";

import { ok_or_throw } from "common";

// The summarizer runs one way; its prompts must offer no modes.
const CHAT_SUMMARY_MODES: readonly string[] = [];

class ChatSummarizer {
  private _model: Model;
  private _system_prompt: string;

  constructor(model: Model, system_prompt: string) {
    this._model = model;
    this._system_prompt = system_prompt;
  }

  /*
   * (Memory[]) => BotReply
   * Summarize a chat transcript into one short, factual digest.
   *
   * The transcript is material, not the summarizer's own conversation, so it
   * goes to the model inside a single user turn. Replayed as turns it would
   * end on the chat's last assistant reply, which the model would continue
   * rather than digest.
   * Side Effect: network call to the model
   * Public
   */
  async summarize(history: Memory[]): Promise<BotReply> {
    const bot = new Chatbot({ model: this._model });
    bot.add_str_to_memory(_render_transcript(history));
    return bot.gen_reply({ system_prompt: this._system_prompt });
  }
}

/*
 * (Memory[]) => string
 * Lay the transcript out as labeled turns separated by blank lines.
 * Pure
 * Private
 */
function _render_transcript(history: Memory[]): string {
  const turns = history.map((turn) => `${turn.role}: ${_text_of(turn)}`);
  return ["Conversation transcript:", ...turns].join("\n\n");
}

/*
 * (Memory) => string
 * A turn's text; blocks that are not text contribute nothing.
 * Pure
 * Private
 */
function _text_of(turn: Memory): string {
  if ("string" === typeof turn.content) return turn.content;
  return turn.content
    .filter((block) => "text" === block.type)
    .map((block) => block.text)
    .join("\n");
}

/*
 * Signature: (Model, PromptNode) => ChatSummarizer
 * Pure
 * Public
 */
function make_chat_summarizer(model: Model, prompts: PromptNode): ChatSummarizer {
  const composed = ok_or_throw(compose_prompt(prompts, []), "ChatSummarizer");
  return new ChatSummarizer(model, composed.context);
}
