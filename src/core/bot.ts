export {
  ChatbotOpts,
  ChatbotMode,
  Chatbot,
}

import { Model, ModelOpts, ModelMessage } from "#core/model.js";
import { Memory } from "#core/memory.js";

interface ChatbotMode {
  name: string;
  description: string;
  mode: string;
};
interface ChatbotOpts {
  model: Model;
  modes?: Record<string, ChatbotMode>;
  init_memory?: Memory[];
}

class Chatbot {
  private _model: Model;
  private _modes: Record<string, ChatbotMode> | null;
  private _current_mode: ChatbotMode | null;
  private _memories: Memory[];

  constructor(opts: ChatbotOpts) {
    this._model = opts.model;
    this._modes = opts.modes ?? null;
    this._current_mode = null;
    this._memories = opts.init_memory ?? []; // TODO: [memory] breaks abstraction
  }

  /*
   * (void) => ChatbotMode | null
   * Gets the current mode or null if no mode is set
   * Pure
   * Public
   */
  public mode(): ChatbotMode | null {
    return this._current_mode;
  }

  /*
   * (string) => ChatbotMode | false
   * Attempts to set the current mode based on the provided mode key
   * Side Effect: Mutates internal mode state
   * Public
   */
  public set_mode(key: string): ChatbotMode | boolean {
    if (null === this._modes) return false;
    const selected_mode = this._modes[key]; 
    if (undefined === selected_mode) return false;
    this._current_mode = selected_mode;
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
   * (void) => ModelMessage
   * Generate a message from the model based on memory state
   * Pure
   * Public
   */
  public async gen_message(opts: ModelOpts): Promise<ModelMessage> {
    return this._model.gen_message(this._memories, opts);
  }
}
