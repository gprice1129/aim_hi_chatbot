export {
  DEFAULT_CONTEXT_BUDGET,
  ContextAssembler,
}
export type {
  ContextBudget,
  HistorySource,
  ProjectContextSource,
  ProjectContext,
  AssembleInput,
  AssembledContext,
}

import * as assert from "node:assert";

import { Memory } from "#core/memory.js";

/*
 * ContextAssembler centralizes the policy for turning gathered context into a
 * prompt-safe shape: clamping untrusted, unbounded text and windowing replayed
 * history before any of it reaches the model.
 *
 * This owns *policy* only. It performs no I/O and knows nothing about the
 * database, files, sessions, or projects: it pulls context through source ports
 * (HistorySource/ProjectContextSource) whose implementations -- and all I/O and
 * user-scoping -- live outside core. assemble() merges project instructions and
 * cross-chat memory with the live turn into a final { system, messages } pair.
 * A later step replaces the char-based budget with token-aware selection.
 *
 * Caps are char-based: a deterministic, dependency-free proxy for token cost.
 * Token-aware budgeting is deferred to a later step; until then these are
 * guardrails against abuse (e.g. a 25MB parsed file, an unbounded paste), not
 * tuned token budgets.
 */

interface ContextBudget {
  // Cap on a single live user turn before it enters the prompt.
  max_message_chars: number;
  // Cap on the number of replayed history turns; the most recent are kept.
  max_history_messages: number;
  // Cap on the total chars of replayed history; oldest turns dropped first.
  max_history_chars: number;
  // Cap on a single injected document (rfa, proposal, aims, ...).
  max_document_chars: number;
}

const DEFAULT_CONTEXT_BUDGET: ContextBudget = Object.freeze({
  max_message_chars:    24_000,   // ~6k tokens for one user turn
  max_history_messages: 40,       // last 40 turns
  max_history_chars:    96_000,   // ~24k tokens of replayed history
  max_document_chars:   200_000,  // ~50k tokens per injected document
});

/*
 * Context sources are ports: async suppliers the assembler pulls from. Their
 * implementations live outside core (e.g. webserver adapters over the database)
 * and own all I/O and user-scoping; core only consumes what they return. This
 * is the seam that keeps the database, files, and auth out of the chatbot core.
 */

// Supplies the current chat's prior conversation turns, oldest-first.
interface HistorySource {
  load(): Promise<Memory[]>;
}

// Resolves the project context for the current chat. A chat belongs to a single
// project (not enforced at the model level), so load() returns one context, or
// null when the chat is in no project. Any multi-project tie-break is the
// adapter's concern, not core's.
interface ProjectContextSource {
  load(): Promise<ProjectContext | null>;
}

interface ProjectContext {
  // Free-form project instructions composed into the system prompt; null when
  // the project sets none.
  instructions: string | null;
  // Cross-chat context turns gathered when the project has memory_enabled;
  // empty otherwise. Already model-shaped -- how cross-chat content is framed
  // or summarized is the adapter's concern (refined in a later step).
  memory: Memory[];
}

// Input to assemble(): the bot's base prompt, the sources to pull from, and the
// live user turn. Every message-shaped input (history, project memory, the live
// turn) is a Memory; only the prompt and instructions are raw text.
interface AssembleInput {
  system_prompt: string;
  history?: HistorySource;
  project?: ProjectContextSource;
  message?: Memory;
}

// The model-ready result of assembly: a composed system prompt and the full
// ordered message list.
interface AssembledContext {
  system: string;
  messages: Memory[];
}

class ContextAssembler {
  private _budget: ContextBudget;

  constructor(budget: Partial<ContextBudget> = {}) {
    this._budget = { ...DEFAULT_CONTEXT_BUDGET, ...budget };
    assert.ok(this._budget.max_message_chars    > 0, "max_message_chars must be > 0");
    assert.ok(this._budget.max_history_messages > 0, "max_history_messages must be > 0");
    assert.ok(this._budget.max_history_chars    > 0, "max_history_chars must be > 0");
    assert.ok(this._budget.max_document_chars   > 0, "max_document_chars must be > 0");
  }

  /*
   * (string, string) => string
   * Clamp a single injected document to its char cap, appending a notice so the
   * model knows content was elided.
   * Pure
   * Public
   */
  public clamp_document(label: string, content: string): string {
    return _clamp(content, this._budget.max_document_chars, label);
  }

  /*
   * (string) => string
   * Clamp a live user turn to its char cap before it enters the prompt.
   * Pure
   * Public
   */
  public clamp_message(message: string): string {
    return _clamp(message, this._budget.max_message_chars, "message");
  }

  /*
   * (Memory[]) => Memory[]
   * Window replayed history to the budget: keep the most recent turns within
   * both the message-count and total-char caps, dropping oldest first. Returns
   * a new array in chronological order; does not mutate the input.
   *
   * The most recent turn is always retained -- clamped to the char budget if it
   * alone exceeds it -- so a single oversized turn never collapses history to
   * empty. A later step replaces char windowing with token-aware selection.
   * Pure
   * Public
   */
  public window_history(history: Memory[]): Memory[] {
    const by_count = history.slice(-this._budget.max_history_messages);
    if (0 === by_count.length) return [];

    const kept: Memory[] = [];
    let total = 0;
    for (let i = by_count.length - 1; i >= 0; i--) {
      const turn = by_count[i];
      const len = _memory_char_length(turn);
      if (0 === kept.length) {
        kept.push(_clamp_memory(turn, this._budget.max_history_chars, "history turn"));
        total += Math.min(len, this._budget.max_history_chars);
        continue;
      }
      if (total + len > this._budget.max_history_chars) break;
      total += len;
      kept.push(turn);
    }
    return kept.reverse();
  }

  /*
   * (AssembleInput) => AssembledContext
   * Pull every provided source, apply the budget, and compose the model-ready
   * { system, messages }. system = base prompt + project instructions; messages
   * = project memory, then this chat's windowed history, then the clamped live
   * turn -- background context first, the new turn last. Omitted sources and a
   * null/empty project simply contribute nothing.
   * Side Effect: awaits source I/O (HistorySource/ProjectContextSource.load)
   * Public
   */
  public async assemble(input: AssembleInput): Promise<AssembledContext> {
    const project = input.project ? await input.project.load() : null;

    let system = input.system_prompt;
    if (null !== project && null !== project.instructions) {
      system = `${system}\n\n${project.instructions}`;
    }

    // TODO:[context] project memory and history are windowed independently, so
    // combined replayed context can reach ~2x max_history_chars and project
    // memory competes with nothing for its share. A unified, token-aware budget
    // across all replayed context -- with a deliberate priority between
    // cross-chat memory and this chat's recent turns -- is a later-step refinement.
    const messages: Memory[] = [];
    if (null !== project && project.memory.length > 0) {
      messages.push(...this.window_history(project.memory));
    }
    if (undefined !== input.history) {
      messages.push(...this.window_history(await input.history.load()));
    }
    if (undefined !== input.message) {
      messages.push(
        _clamp_memory(input.message, this._budget.max_message_chars, "message"));
    }
    return { system, messages };
  }
}

/*
 * (string, number, string) => string
 * Truncate text to max chars, appending a one-line notice when it was cut.
 *
 * TODO:[context] hard truncation is a deliberately simplistic strategy -- it
 * drops the tail of a document and the oldest turns of history outright. Later
 * we may want smarter reduction: summarizing older message history, compressing
 * or extracting the relevant parts of large documents, or token-aware selection
 * instead of a blunt char cap. This is the seam where that lands.
 * Pure
 * Private
 */
function _clamp(text: string, max: number, label: string): string {
  if (text.length <= max) return text;
  return text.slice(0, max) +
    `\n\n[…truncated: ${label} exceeded ${max} chars…]`;
}

/*
 * (Memory, number, string) => Memory
 * Clamp a memory's content to max chars. String content is clamped in a fresh
 * memory; structured block content is left intact until token-aware
 * measurement lands. Does not mutate the input.
 * Pure
 * Private
 */
function _clamp_memory(memory: Memory, max: number, label: string): Memory {
  if ("string" === typeof memory.content) {
    return { ...memory, content: _clamp(memory.content, max, label) };
  }
  return memory;
}

/*
 * (Memory) => number
 * Char length of a memory's content. String content is measured directly;
 * structured block content is approximated by its serialized length until
 * token-aware measurement lands.
 * Pure
 * Private
 */
function _memory_char_length(memory: Memory): number {
  if ("string" === typeof memory.content) return memory.content.length;
  return JSON.stringify(memory.content).length;
}
