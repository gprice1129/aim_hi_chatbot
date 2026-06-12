export {
  ChatbotOpts,
  ChatbotMode,
  Chatbot,
}

import { Model, ModelOpts, ModelMessage } from "#core/model.js";
import { Memory } from "#core/memory.js";
import { BotFailure, type BotReply } from "#core/result.js";

interface ChatbotMode {
  name: string;
  description: string;
  prompt: string;
  context: string;
};
interface ChatbotOpts {
  model: Model;
  modes?: Record<string, ChatbotMode>;
  init_memory?: Memory[];
}

class Chatbot {
  private _model: Model;
  private _modes: Record<string, ChatbotMode> | null;
  private _current_mode: string | null;
  private _memories: Memory[];

  constructor(opts: ChatbotOpts) {
    this._model = opts.model;
    this._modes = opts.modes ?? null;
    this._current_mode = null;
    this._memories = opts.init_memory ?? []; // TODO: [memory] breaks abstraction
  }

  /*
   * (void) => string | null
   * Gets the current mode ID or null if no mode is set
   * Pure
   * Public
   */
  public mode_id(): string | null {
    if (null === this._current_mode) return null;
    return this._current_mode;
  }

  /*
   * (void) => ChatbotMode | null
   * Gets the current mode or null if no mode is set
   * Pure
   * Public
   */
  public mode(): ChatbotMode | null {
    if (null === this._modes || null === this._current_mode) return null;
    return this._modes[this._current_mode];
  }

  /*
   * (string) => ChatbotMode | false
   * Attempts to set the current mode based on the provided mode key
   * Side Effect: Mutates internal mode state
   * Public
   */
  public set_mode(key: string): string | boolean {
    if (null === this._modes) return false;
    const selected_mode = this._modes[key]; 
    if (undefined === selected_mode) return false;
    this._current_mode = key;
    return this._current_mode;
  }

  /*
   * (string) => Memory
   * Constructs a Memory for the current Model
   * Pure
   * Public
   */
  public str_to_memory(str: string): Memory {
    return this._model.str_to_memory(str);
  }

  /*
   * (Memory) => void
   * Append a Memory to memories
   * Side Effect: Mutates memory state
   * Public
   */
  public add_memory(memory: Memory): void {
    this._memories.push(memory);
  }

  /*
   * (Memory) => void
   * Convers a string to a memory and appends to all memories
   * Side Effect: Mutates memory state
   * Public
   */
  public add_str_to_memory(str: string): void {
    this._memories.push(this._model.str_to_memory(str));
  }

  /*
   * (void) => ModelMessage
   * Generate a message from the model based on memory state
   * Pure
   * Public
   */
  public async gen_message(opts: ModelOpts): Promise<ModelMessage> {
    return this._model.gen_message(this._memories, opts);
  }

  public extract_content(msg: ModelMessage): string[] | false {
    return this._model.extract_content(msg);
  }

  /*
   * (ModelOpts) => BotReply
   * Generate a message and return a usable reply or a classified failure.
   * Side Effect: network call to the model
   * Public
   */
  public async gen_reply(opts: ModelOpts): Promise<BotReply> {
    let msg: ModelMessage;
    try {
      msg = await this.gen_message(opts);
    } catch (err) {
      return { ok: false, failure: BotFailure.UNAVAILABLE, cause: err };
    }
    const content = this.extract_content(msg);
    if (false === content) return { ok: false, failure: BotFailure.INCOMPLETE };
    return { ok: true, content };
  }
}
