export {
  make_document_builder,
  DocumentBuilder,
  DOCUMENT_BUILDER_MODES,
  DEFAULT_OPENING_TURN,
  TEMPLATE_PLACEHOLDER,
  DOCUMENT_PLACEHOLDER,
}

import { Chatbot } from "#core/bot.js";
import type { ReplyStream, ToolRound } from "#core/stream.js";
import { ContextAssembler, type HistorySource } from "#core/context.js";
import type { Model } from "#core/model.js";
import { ToolRegistry, type Tool } from "#core/tool.js";
import type { BotReply } from "#core/result.js";
import type { BotTrace } from "#core/trace.js";
import {
  render_document,
  render_template_guidance,
  type DocumentState,
  type DocumentTemplate,
} from "#core/document.js";
import { UpdateSectionTool } from "#tools/document.js";
import { SetTitleTool, type SessionTitle } from "#tools/title.js";
import { compose_prompt, type ComposedPrompt, type PromptNode } from "#prompts/prompt_tree.js";

import { ok_or_throw } from "common";

/*
 * Main Concept
 * -----------------------------------------------------------------------------
 * A bot that interviews the user and writes a document as it learns. One
 * prompt serves every template: the template's guidance and the document as
 * it stands are composed into the system prompt each turn, and the bot writes
 * through the update_section tool. Given the session's title, it may also
 * name the session through the set_title tool.
 */

/*
 * Application Usage
 * -----------------------------------------------------------------------------
 * The host builds one DocumentBuilder per reply, with the chat's document and
 * any other tools it may use, and reads the document back afterwards. A null
 * message opens the conversation: the bot speaks first, from the prompt's
 * opening turn.
 */

// Where the prompt wants the template's guidance and the current document.
const TEMPLATE_PLACEHOLDER = "{templateGuidance}";
const DOCUMENT_PLACEHOLDER = "{documentState}";

// The opening turn when the prompt declares none.
const DEFAULT_OPENING_TURN =
  "Begin. Introduce what you will help write, in two sentences, then ask your first question.";

// The builder's prompt is one document with no modes.
const DOCUMENT_BUILDER_MODES: readonly string[] = [];

class DocumentBuilder {
  private _bot: Chatbot;
  private _assembler: ContextAssembler;
  private _prompt: ComposedPrompt;
  private _template: DocumentTemplate;
  private _tool: UpdateSectionTool;
  private _title_tool: SetTitleTool | null;

  constructor(
      bot: Chatbot,
      assembler: ContextAssembler,
      prompt: ComposedPrompt,
      template: DocumentTemplate,
      tool: UpdateSectionTool,
      title_tool: SetTitleTool | null) {
    this._bot = bot;
    this._assembler = assembler;
    this._prompt = prompt;
    this._template = template;
    this._tool = tool;
    this._title_tool = title_tool;
  }

  /*
   * (HistorySource, string | null, ReplyStream?) => BotReply
   * One turn. A null message is the opening turn: nothing from the user, the
   * prompt's opener in its place.
   * Side Effect: model calls; may write the document through the tool
   * Public
   */
  async respond(
      history: HistorySource,
      message: string | null,
      stream?: ReplyStream): Promise<BotReply> {
    const system_prompt = this._prompt.context
      .replaceAll(TEMPLATE_PLACEHOLDER, () => render_template_guidance(this._template))
      .replaceAll(DOCUMENT_PLACEHOLDER, () => render_document(this._template, this._tool.document()));
    const turn = message ?? this._prompt.prompt ?? DEFAULT_OPENING_TURN;
    const { system, messages } = await this._assembler.assemble({
      system_prompt,
      history,
      message: this._bot.str_to_memory(turn),
    });
    for (const memory of messages) {
      this._bot.add_memory(memory);
    }
    return this._bot.gen_reply({ stream, system_prompt: system });
  }

  // The document after the most recent respond.
  document(): DocumentState {
    return this._tool.document();
  }

  // The sections the most recent respond wrote, in the order first written.
  changed_sections(): string[] {
    return this._tool.changed();
  }

  // The name the most recent respond gave the session; null when it gave none.
  title(): string | null {
    return this._title_tool?.title() ?? null;
  }

  trace(): BotTrace {
    return this._bot.trace();
  }

  tool_rounds(): ToolRound[] {
    return this._bot.tool_rounds();
  }
}

/*
 * Signature: (Model, PromptNode, DocumentTemplate, DocumentState, Tool[], (() => string)?,
 *   SessionTitle?) => DocumentBuilder
 * `tools` are offered beside update_section; a knowledge base, say. Given
 * `title`, the session's title as the turn begins, set_title is offered too.
 * Pure
 * Public
 */
function make_document_builder(
    model: Model,
    prompts: PromptNode,
    template: DocumentTemplate,
    document: DocumentState,
    tools: Tool[] = [],
    now?: () => string,
    title?: SessionTitle): DocumentBuilder {
  const composed = ok_or_throw(compose_prompt(prompts, []), "DocumentBuilder");
  const tool = new UpdateSectionTool(template, document, now);
  const title_tool = undefined === title ? null : new SetTitleTool(title);
  const offered = null === title_tool ? [...tools, tool] : [...tools, tool, title_tool];
  const bot = new Chatbot({ model, tools: new ToolRegistry(offered) });
  return new DocumentBuilder(bot, new ContextAssembler(), composed, template, tool, title_tool);
}
