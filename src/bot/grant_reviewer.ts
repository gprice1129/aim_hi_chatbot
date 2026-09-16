export {
  make_grant_reviewer,
  GrantReviewMode,
  GrantReviewContent,
  GRANT_REVIEW_MODES,
}

import { Chatbot, type ChatbotMode, type ReplyStream } from "#core/bot.js";
import { ContextAssembler } from "#core/context.js";
import type { Model } from "#core/model.js";
import type { BotReply } from "#core/result.js";
import { compose_prompt, type PromptNode } from "#prompts/prompt_tree.js";

import { ok_or_throw } from "common";

interface GrantReviewContent {
  rfa: string;
  proposal?: string;
  aims?: string;
}

class GrantReviewer {
  private _bot: Chatbot
  private _assembler: ContextAssembler;
  private _context: string | null;
  constructor(bot: Chatbot, assembler: ContextAssembler) {
    this._bot = bot;
    this._assembler = assembler;
    this._context = null;
  }
  mode() {
    return this._bot.mode_id();
  }
  mode_context() {
    return this._bot.mode()?.context ?? null;
  }
  mode_prompt() {
    return this._bot.mode()?.prompt ?? null;
  }
  set_mode(mode: GrantReviewMode): boolean {
    const new_mode = this._bot.set_mode(mode);
    if (false === new_mode) return false;
    return true;
  }
  set_context(content: GrantReviewContent): boolean {
    // TODO:[grant reviewer] validate content
    const mode_context = this.mode_context();
    if (null === mode_context) return false;
    this._context = mode_context
      .replace(/{rfaContent}/g, this._assembler.clamp_document("rfa", content.rfa))
      .replace(/{proposalContent}/g, this._assembler.clamp_document("proposal", content.proposal ?? ""))
      .replace(/{aimsContent}/g, this._assembler.clamp_document("aims", content.aims ?? ""));
    return true;
  }

  async review(stream: ReplyStream = {}): Promise<BotReply> {
    const prompt = this.mode_prompt();
    if (null === this._context) {
      throw new Error("GrantReviewer.review called before set_context");
    }
    if (null !== prompt) {
      this._bot.add_str_to_memory(prompt);
    }
    return this._bot.gen_reply({ ...stream, system_prompt: this._context });
  }
}

/*
 * Signature: (Model, PromptNode) => GrantReviewer
 * Pure
 * Public
 */
function make_grant_reviewer(model: Model, prompts: PromptNode): GrantReviewer {
  const bot = new Chatbot({
    model,
    modes: _make_modes(prompts),
  });
  return new GrantReviewer(bot, new ContextAssembler());
}

/*
 * Signature: (PromptNode) => Record<string, ChatbotMode>
 * One composed mode per way the reviewer can review, keyed as the code
 * selects them.
 * Pure
 * Private
 */
function _make_modes(prompts: PromptNode): Record<string, ChatbotMode> {
  const modes: Record<string, ChatbotMode> = {};
  for (const key of Object.values(GrantReviewMode)) {
    const composed = ok_or_throw(compose_prompt(prompts, [key]), "GrantReviewer");
    const node = prompts.modes[key];
    modes[key] = {
      name: node.name,
      description: node.description,
      prompt: composed.prompt,
      context: composed.context,
    };
  }
  return modes;
}

enum GrantReviewMode {
  STANDARD = "standard",
  SUMMARY = "summary",
  TECHNICAL = "technical",
  SCORED = "scored",
  AIMS = "aims"
}

// The modes the reviewer's prompts must offer: exactly those its code selects among.
const GRANT_REVIEW_MODES: readonly string[] = Object.values(GrantReviewMode);
