export {
  MockModel,
}
export type {
  MockModelOpts,
  MockCall,
  MockReply,
  MockToolRequest,
}

import { Anthropic } from "@anthropic-ai/sdk";
import { Model, ModelMessage, ModelOpts } from "#core/model.js";
import { Memory } from "#core/memory.js";
import type { ToolCall, ToolInput, ToolResult } from "#core/tool.js";
import { as_tool_input } from "#core/tool_input.js";

/*
 * MockModel is a deterministic, offline Model double. It performs no network
 * I/O: gen_message returns a canned assistant message, so the bots, routes, and
 * the webserver can be exercised without a real provider. The host selects it
 * under MODEL_MODE=mock; unit tests construct it directly.
 *
 * By default every call returns the same `reply`. Pass `replies` to script a
 * multi-turn sequence (consumed in order, then falling back to `reply`). Each
 * call's (memories, opts) is recorded on calls() for assertions.
 *
 * A scripted entry may be a tool request instead of a string, which drives the
 * tool loop in core/bot.ts end to end with no provider and no real tools.
 */

// A scripted turn that asks for tools. Several calls in one entry model a
// provider requesting them together in a single turn.
interface MockToolRequest {
  calls: { name: string; input?: ToolInput }[];
}

// One scripted turn: text ends the turn, a tool request continues it.
type MockReply = string | MockToolRequest;

interface MockModelOpts {
  // Reply returned once any scripted replies are exhausted.
  reply?: string;
  // Scripted replies, returned in order before falling back to `reply`.
  replies?: MockReply[];
}

interface MockCall {
  memories: Memory[];
  opts: ModelOpts;
}

const DEFAULT_REPLY = "[mock-llm] canned reply";

class MockModel implements Model {
  private _reply: string;
  private _scripted: MockReply[];
  private _calls: MockCall[];
  // Monotonic so scripted tool ids are unique within a run and stable across
  // runs, which keeps assertions on the transcript deterministic.
  private _next_tool_id: number;

  constructor(opts: MockModelOpts = {}) {
    this._reply = opts.reply ?? DEFAULT_REPLY;
    this._scripted = [...(opts.replies ?? [])];
    this._calls = [];
    this._next_tool_id = 0;
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
    // Copy: the caller keeps mutating its memory list across a tool loop, and a
    // recorded call must stay a snapshot of what this turn actually saw.
    this._calls.push({ memories: [...memories], opts });
    const scripted = this._scripted.length > 0
      ? this._scripted.shift() as MockReply
      : this._reply;
    if ("string" === typeof scripted) return _mock_message(scripted);
    return _mock_tool_message(scripted.calls.map((call) => ({
      id: `toolu_mock_${this._next_tool_id++}`,
      name: call.name,
      input: call.input ?? {},
    })));
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

  /*
   * (ModelMessage) => boolean
   * Pure
   * Public
   */
  public wants_tools(msg: ModelMessage): boolean {
    return "tool_use" === msg.stop_reason;
  }

  /*
   * (ModelMessage) => ToolCall[]
   * Pure
   * Public
   */
  public extract_tool_calls(msg: ModelMessage): ToolCall[] {
    const calls: ToolCall[] = [];
    for (const block of msg.content) {
      if ("tool_use" !== block.type) continue;
      calls.push({ id: block.id, name: block.name, input: as_tool_input(block.input) });
    }
    return calls;
  }

  /*
   * (ModelMessage) => Memory
   * Pure
   * Public
   */
  public msg_to_memory(msg: ModelMessage): Memory {
    return { role: "assistant", content: msg.content as Anthropic.ContentBlockParam[] };
  }

  /*
   * (ToolResult[]) => Memory
   * Pure
   * Public
   */
  public tool_results_to_memory(results: ToolResult[]): Memory {
    return {
      role: "user",
      content: results.map((result): Anthropic.ToolResultBlockParam => ({
        type: "tool_result",
        tool_use_id: result.id,
        content: result.ok ? result.value : result.error,
        ...(result.ok ? {} : { is_error: true }),
      })),
    };
  }
}

/*
 * (string) => Anthropic.Message
 * Build a minimal, well-formed assistant Message wrapping `text`.
 * Pure
 * Private
 */
function _mock_message(text: string): Anthropic.Message {
  return _envelope([{ type: "text", text, citations: null }], "end_turn");
}

/*
 * ({id, name, input}[]) => Anthropic.Message
 * Build an assistant Message that stops to request tools, mirroring what the
 * provider sends so the loop under test is the real one.
 * Pure
 * Private
 */
function _mock_tool_message(
    calls: { id: string; name: string; input: ToolInput }[]): Anthropic.Message {
  return _envelope(
    calls.map((call): Anthropic.ToolUseBlock => ({
      type: "tool_use",
      id: call.id,
      name: call.name,
      input: call.input,
      caller: { type: "direct" },
    })),
    "tool_use");
}

/*
 * (Anthropic.ContentBlock[], Anthropic.StopReason) => Anthropic.Message
 * Wrap content blocks in a well-formed Message. Usage is zeroed -- the mock
 * does no real token accounting.
 * Pure
 * Private
 */
function _envelope(
    content: Anthropic.ContentBlock[],
    stop_reason: Anthropic.StopReason): Anthropic.Message {
  return {
    id: "msg_mock",
    type: "message",
    role: "assistant",
    model: "mock-model",
    content,
    stop_reason,
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
