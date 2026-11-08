export {
  make_ally,
  ALLY_MODES,
  ALLY_DEFAULT_MODE,
}

import { Chatbot } from "#core/bot.js";
import type { ReplyStream, ToolRound } from "#core/stream.js";
import { ContextAssembler } from "#core/context.js";
import type { DocumentContext, HistorySource, ProjectContextSource } from "#core/context.js";
import type { Model } from "#core/model.js";
import type { ToolRegistry } from "#core/tool.js";
import type { BotReply } from "#core/result.js";
import type { BotTrace } from "#core/trace.js";
import { compose_prompt, type PromptNode } from "#prompts/prompt_tree.js";

import { ok_or_throw } from "common";

// The mode Ally is in until asked to be in another.
const ALLY_DEFAULT_MODE = "general";

// The modes Ally's prompts must offer.
const ALLY_MODES: readonly string[] = [ALLY_DEFAULT_MODE];

class Ally {
  private _bot: Chatbot;
  private _assembler: ContextAssembler;
  private _system_prompt: string;
  private _opener: string | null;
  private _document: DocumentContext | null;

  constructor(
      bot: Chatbot,
      assembler: ContextAssembler,
      system_prompt: string,
      opener: string | null,
      document: DocumentContext | null) {
    this._bot = bot;
    this._assembler = assembler;
    this._system_prompt = system_prompt;
    this._opener = opener;
    this._document = document;
  }

  /*
   * (HistorySource, ProjectContextSource, string | null, ReplyStream?) => BotReply
   * A null message asks Ally to speak first: the prompt's opening turn stands
   * in for the user's. A prompt that declares none cannot open, so that throws.
   * Side Effect: model calls; runs tools
   * Public
   */
  async respond(
    history: HistorySource,
    project: ProjectContextSource,
    message: string | null,
    stream?: ReplyStream,
  ): Promise<BotReply> {
    const turn = message ?? this._opener;
    if (null === turn) {
      throw new Error("Ally was asked to open the conversation, but its prompt declares no opening turn");
    }
    const { system, messages } = await this._assembler.assemble({
      system_prompt: this._system_prompt,
      history,
      project,
      document: this._document ?? undefined,
      message: this._bot.str_to_memory(turn),
    });
    for (const turn of messages) {
      this._bot.add_memory(turn);
    }
    return this._bot.gen_reply({ stream, system_prompt: system });
  }

  // What happened during the most recent respond: rounds, tool calls, tokens.
  trace(): BotTrace {
    return this._bot.trace();
  }

  // The tool rounds behind the most recent respond, as a caller may show them.
  tool_rounds(): ToolRound[] {
    return this._bot.tool_rounds();
  }
}

/*
 * Signature: (Model, PromptNode, ToolRegistry?, DocumentContext?) => Ally
 * Without tools Ally only converses. Given a document, Ally reads it as it
 * stands each turn; writing it is a tool the caller offers alongside. The
 * prompt's opening turn, if it declares one, is what Ally says first when
 * asked to speak first.
 * Pure
 * Public
 */
function make_ally(
    model: Model,
    prompts: PromptNode,
    tools?: ToolRegistry,
    document?: DocumentContext): Ally {
  const composed = ok_or_throw(compose_prompt(prompts, [ALLY_DEFAULT_MODE]), "Ally");
  const bot = new Chatbot({ model, tools });
  return new Ally(
    bot, new ContextAssembler(), composed.context, composed.prompt, document ?? null);
}
