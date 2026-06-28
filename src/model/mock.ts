export {
  MockModel,
}
export type {
  MockModelOpts,
  MockCall,
}

import { Anthropic } from "@anthropic-ai/sdk";
import { Model, ModelMessage, ModelOpts } from "#core/model.js";
import { Memory } from "#core/memory.js";

/*
 * MockModel is a deterministic, offline Model double. It performs no network
 * I/O: gen_message returns a canned assistant message, so the bots, routes, and
 * the webserver can be exercised without a real provider. The host selects it
 * in test mode (APP_ENV=test); unit tests construct it directly.
 *
 * By default every call returns the same `reply`. Pass `replies` to script a
 * multi-turn sequence (consumed in order, then falling back to `reply`). Each
 * call's (memories, opts) is recorded on calls() for assertions.
 */

interface MockModelOpts {
  // Reply returned once any scripted replies are exhausted.
  reply?: string;
  // Scripted replies, returned in order before falling back to `reply`.
  replies?: string[];
}

interface MockCall {
  memories: Memory[];
  opts: ModelOpts;
}

const DEFAULT_REPLY = "[mock-llm] canned reply";

class MockModel implements Model {
  private _reply: string;
  private _scripted: string[];
  private _calls: MockCall[];

  constructor(opts: MockModelOpts = {}) {
    this._reply = opts.reply ?? DEFAULT_REPLY;
    this._scripted = [...(opts.replies ?? [])];
    this._calls = [];
  }

  /*
   * (void) => readonly MockCall[]
   * The (memories, opts) seen by each gen_message call, in order.
   * Pure
   * Public
   */
  public calls(): readonly MockCall[] {
    return this._calls;
  }

  /*
   * (string) => Memory
   * Pure
   * Public
   */
  public str_to_memory(str: string): Memory {
    return { role: "user", content: str };
  }

  /*
   * (Memory[], ModelOpts) => ModelMessage
   * Record the call and return a canned assistant message. No network I/O.
   * Side Effect: records the call
   * Public
   */
  public async gen_message(memories: Memory[], opts: ModelOpts): Promise<ModelMessage> {
    this._calls.push({ memories, opts });
    const text = this._scripted.length > 0
      ? this._scripted.shift() as string
      : this._reply;
    return _mock_message(text);
  }

  /*
   * (ModelMessage) => string[] | false
   * Extract text blocks from a completed turn; false when not end_turn. Mirrors
   * AnthropicModel so both stop-reason paths behave the same.
   * Pure
   * Public
   */
  public extract_content(msg: ModelMessage): string[] | false {
    if ("end_turn" !== msg.stop_reason) return false;
    const blocks: string[] = [];
    for (const block of msg.content) {
      if ("text" === block.type) blocks.push(block.text);
    }
    return blocks;
  }
}

/*
 * (string) => Anthropic.Message
 * Build a minimal, well-formed assistant Message wrapping `text`. Usage is
 * zeroed -- the mock does no real token accounting.
 * Pure
 * Private
 */
function _mock_message(text: string): Anthropic.Message {
  return {
    id: "msg_mock",
    type: "message",
    role: "assistant",
    model: "mock-model",
    content: [{ type: "text", text, citations: null }],
    stop_reason: "end_turn",
    stop_sequence: null,
    container: null,
    usage: {
      input_tokens: 0,
      output_tokens: 0,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
      cache_creation: null,
      inference_geo: null,
      server_tool_use: null,
      service_tier: null,
    },
  };
}
