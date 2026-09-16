export {
  empty_trace,
  note_model_call,
  note_tool_results,
}
export type {
  BotTrace,
  TraceStep,
  TraceToolCall,
  TraceUsage,
}

import type { ModelMessage } from "#core/model.js";
import type { ToolCall, ToolInput, ToolResult } from "#core/tool.js";

/*
 * Main Concept
 * -----------------------------------------------------------------------------
 * This file defines the record of what happened while a bot produced one
 * reply: how many times the model was called, every tool call with the
 * asked/answered pair and the tokens spent.
 */

/*
 * Application Usage
 * -----------------------------------------------------------------------------
 * A reply carries only the text the model ended with. The trace is how a host
 * can see the tool calls and rounds behind that text, for a debug view or a
 * test that must know whether a tool ran rather than guess from prose. Its
 * steps are the part fit to show a person: what the model wrote and asked for
 * in each tool round, without what the tools answered.
 */

// Bodies a tool returns can run to thousands of characters. A trace keeps
// enough of each result to recognise it.
const RESULT_PREVIEW_CHARS = 300;

// One tool call: what the model asked for, and how the tool answered.
interface TraceToolCall {
  round: number;
  name: string;
  input: ToolInput;
  ok: boolean;
  // The start of the tool's answer, or its whole error.
  result: string;
}

// One round that stopped to use tools: the text the model wrote first, then
// the calls it made and whether each succeeded.
interface TraceStep {
  text: string;
  calls: { name: string; input: ToolInput; ok: boolean }[];
}

// Tokens across every model call of the turn.
interface TraceUsage {
  input_tokens: number;
  output_tokens: number;
}

// Everything observable about one reply.
interface BotTrace {
  rounds: number;
  tool_calls: TraceToolCall[];
  steps: TraceStep[];
  usage: TraceUsage;
}

/*
 * Idea: A trace with nothing in it yet.
 *
 * (void) => BotTrace
 * Pure
 * Public
 */
function empty_trace(): BotTrace {
  return { rounds: 0, tool_calls: [], steps: [], usage: { input_tokens: 0, output_tokens: 0 } };
}

/*
 * Idea: Count a model call and the tokens it spent.
 *
 * (BotTrace, ModelMessage) => void
 * Side Effect: mutates the trace
 * Public
 */
function note_model_call(trace: BotTrace, msg: ModelMessage): void {
  trace.rounds += 1;
  trace.usage.input_tokens += msg.usage.input_tokens;
  trace.usage.output_tokens += msg.usage.output_tokens;
}

/*
 * Idea: Record a round of tool calls against their results.
 *
 * (BotTrace, number, ModelMessage, ToolCall[], ToolResult[]) => void
 * Calls and results correspond by position, as run_all guarantees. The message
 * is the turn that asked for the calls; its text is the round's lead-in.
 * Side Effect: mutates the trace
 * Public
 */
function note_tool_results(
    trace: BotTrace, round: number, msg: ModelMessage,
    calls: ToolCall[], results: ToolResult[]): void {
  const step: TraceStep = { text: _text(msg), calls: [] };
  for (let i = 0; i < calls.length; i++) {
    const call = calls[i];
    const result = results[i];
    trace.tool_calls.push({
      round,
      name: call.name,
      input: call.input,
      ok: result.ok,
      result: _preview(result),
    });
    step.calls.push({ name: call.name, input: call.input, ok: result.ok });
  }
  trace.steps.push(step);
}

/*
 * Idea: What a tool answered, cut to a recognisable length.
 *
 * (ToolResult) => string
 * Pure
 * Private
 */
function _preview(result: ToolResult): string {
  if (!result.ok) return result.error;
  if (result.value.length <= RESULT_PREVIEW_CHARS) return result.value;
  return result.value.slice(0, RESULT_PREVIEW_CHARS) + "...";
}

/*
 * Idea: The text blocks of a turn, separated as a reply's blocks are.
 *
 * (ModelMessage) => string
 * Pure
 * Private
 */
function _text(msg: ModelMessage): string {
  return msg.content
    .flatMap((block) => "text" === block.type ? [block.text] : [])
    .join("\n\n");
}
