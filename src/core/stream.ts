export type {
  ToolCallSummary,
  ToolRound,
  ReplyEvent,
  ReplyStream,
}

import type { ToolInput } from "#core/tool.js";

/*
 * Main Concept
 * -----------------------------------------------------------------------------
 * One stream carries a reply from the model to whoever asked for it. Every
 * layer speaks the same events: the model reports its text, the reply loop
 * adds what only it can know about tool use, and a host passes the whole
 * thing on. There is one sink for every event, and one signal by which the
 * host cancels.
 */

/*
 * Idea: A tool call as a caller may see it: the tool and its input, with no
 * provider id.
 */
interface ToolCallSummary {
  name: string;
  input: ToolInput;
}

/*
 * Idea: One round of a reply that stopped to use tools.
 *
 * This is what a caller may know about a reply's tool use, offered as plain
 * data with no tool output in it. The text is in blocks, as a reply is.
 */
interface ToolRound {
  text: string[];
  calls: { name: string; input: ToolInput; ok: boolean }[];
}

/*
 * Idea: What a reply can report while it is being generated.
 *
 * The model emits `text`: a piece of the reply as it writes it. The reply
 * loop emits the rest. `tool_calls` says a turn stopped to call tools and
 * they are about to run, so the text delivered since the last tool event was
 * that round's preface, not the answer. `tool_round` follows once they have
 * run, with the preface and each call's outcome.
 */
type ReplyEvent =
  | { type: "text"; text: string }
  | { type: "tool_calls"; calls: ToolCallSummary[] }
  | { type: "tool_round"; round: ToolRound };

/*
 * Idea: What a host can observe and control while a reply is generated.
 */
interface ReplyStream {
  // Receives each event as it happens.
  on_event: (event: ReplyEvent) => void;
  // Aborts the reply. The provider call rejects, and the rejection is the
  // host's to classify.
  abort_signal: AbortSignal;
}
