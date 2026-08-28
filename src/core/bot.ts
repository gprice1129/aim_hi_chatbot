export {
  ChatbotOpts,
  ChatbotMode,
  Chatbot,
}

import { Model, ModelOpts, ModelMessage } from "#core/model.js";
import { Memory } from "#core/memory.js";
import { BotFailure, type BotReply } from "#core/result.js";
import { ToolRegistry } from "#core/tool.js";
import { empty_trace, note_model_call, note_tool_results, type BotTrace } from "#core/trace.js";

// How many rounds of tool execution one reply may take before the bot gives up.
const DEFAULT_MAX_TOOL_ROUNDS = 8;

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
  // Tools this bot may call. Omit for a bot that only converses.
  tools?: ToolRegistry;
  max_tool_rounds?: number;
}

class Chatbot {
  private _model: Model;
  private _modes: Record<string, ChatbotMode> | null;
  private _current_mode: string | null;
  private _memories: Memory[];
  private _tools: ToolRegistry | null;
  private _max_tool_rounds: number;
  private _last_trace: BotTrace;

  constructor(opts: ChatbotOpts) {
    this._model = opts.model;
    this._modes = opts.modes ?? null;
    this._current_mode = null;
    this._memories = opts.init_memory ?? []; // TODO: [memory] breaks abstraction
    this._tools = opts.tools ?? null;
    this._max_tool_rounds = opts.max_tool_rounds ?? DEFAULT_MAX_TOOL_ROUNDS;
    this._last_trace = empty_trace();
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
   * (void) => ToolRegistry | null
   * Pure
   * Public
   */
  public tools(): ToolRegistry | null {
    return this._tools;
  }

  /*
   * (void) => BotTrace
   * What happened during the most recent gen_reply. Empty before the first.
   * Pure
   * Public
   */
  public trace(): BotTrace {
    return this._last_trace;
  }

  /*
   * (ModelOpts) => BotReply
   * Generate a message and return a usable reply or a classified failure.
   *
   * When the bot has tools, this is the agentic loop for tool usage.
   * It returns only on a turn that stopped to reply or on the round cap.
   * Side Effect: network calls to the model; runs tools; mutates memory state
   * Public
   */
  public async gen_reply(opts: ModelOpts): Promise<BotReply> {
    const registry = this._tools;
    const offered = null === registry ? [] : registry.tools();
    const call_opts = offered.length > 0 ? { ...opts, tools: offered } : opts;
    // Assigned before the loop so an early return still leaves what happened.
    const trace = empty_trace();
    this._last_trace = trace;

    for (let round = 0; ; round++) {
      let msg: ModelMessage;
      try {
        msg = await this.gen_message(call_opts);
      } catch (err) {
        return { ok: false, error: { failure: BotFailure.UNAVAILABLE, cause: err } };
      }
      note_model_call(trace, msg);

      if (null === registry || !this._model.wants_tools(msg)) {
        const content = this.extract_content(msg);
        if (false === content) {
          return { ok: false, error: { failure: BotFailure.INCOMPLETE } };
        }
        return { ok: true, value: content };
      }

      const calls = this._model.extract_tool_calls(msg);
      if (0 === calls.length) {
        return { ok: false, error: { failure: BotFailure.INCOMPLETE } };
      }
      if (round >= this._max_tool_rounds) {
        return { ok: false, error: { failure: BotFailure.TOOL_LIMIT } };
      }

      this.add_memory(this._model.msg_to_memory(msg));
      const results = await registry.run_all(calls);
      note_tool_results(trace, round, calls, results);
      this.add_memory(this._model.tool_results_to_memory(results));
    }
  }
}
