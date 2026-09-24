export {
  make_ally,
  ALLY_MODES,
  ALLY_DEFAULT_MODE,
  ALLY_SLUG,
}

import { Chatbot } from "#core/bot.js";
import type { ReplyStream, ToolRound } from "#core/stream.js";
import { ContextAssembler } from "#core/context.js";
import type { HistorySource, ProjectContextSource } from "#core/context.js";
import type { Model } from "#core/model.js";
import type { ToolRegistry } from "#core/tool.js";
import type { BotReply } from "#core/result.js";
import type { BotTrace } from "#core/trace.js";
import { compose_prompt, type PromptNode } from "#prompts/prompt_tree.js";

import { ok_or_throw } from "common";

// Ally's application slug. Must match its seeded applications row.
const ALLY_SLUG = "ally";

// The mode Ally is in until asked to be in another.
const ALLY_DEFAULT_MODE = "general";

// The modes Ally's prompts must offer.
const ALLY_MODES: readonly string[] = [ALLY_DEFAULT_MODE];

class Ally {
  private _bot: Chatbot;
  private _assembler: ContextAssembler;
  private _system_prompt: string;

  constructor(bot: Chatbot, assembler: ContextAssembler, system_prompt: string) {
    this._bot = bot;
    this._assembler = assembler;
    this._system_prompt = system_prompt;
  }

  async respond(
    history: HistorySource,
    project: ProjectContextSource,
    message: string,
    stream?: ReplyStream,
  ): Promise<BotReply> {
    const { system, messages } = await this._assembler.assemble({
      system_prompt: this._system_prompt,
      history,
      project,
      message: this._bot.str_to_memory(message),
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
 * Signature: (Model, PromptNode, ToolRegistry?) => Ally
 * Without tools Ally only converses.
 * Pure
 * Public
 */
function make_ally(model: Model, prompts: PromptNode, tools?: ToolRegistry): Ally {
  const composed = ok_or_throw(compose_prompt(prompts, [ALLY_DEFAULT_MODE]), "Ally");
  const bot = new Chatbot({ model, tools });
  return new Ally(bot, new ContextAssembler(), composed.context);
}
