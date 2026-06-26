export {
  DEFAULT_CONTEXT_BUDGET,
  ContextAssembler,
}
export type {
  ContextBudget,
}

import * as assert from "node:assert";

import { Memory } from "#core/memory.js";

/*
 * ContextAssembler centralizes the policy for turning gathered context into a
 * prompt-safe shape: clamping untrusted, unbounded text and windowing replayed
 * history before any of it reaches the model.
 *
 * Step 1 of the memory/context refactor: this owns *policy* only. It performs
 * no I/O and knows nothing about the database, files, sessions, or projects --
 * callers still gather and pass data in. Later steps add source ports (so bots
 * pull lazily) and a full assemble() that merges project instructions and
 * cross-chat memory into a final { system, messages } pair.
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
        kept.push(_clamp_memory(turn, this._budget.max_history_chars));
        total += Math.min(len, this._budget.max_history_chars);
        continue;
      }
      if (total + len > this._budget.max_history_chars) break;
      total += len;
      kept.push(turn);
    }
    return kept.reverse();
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
 * (Memory, number) => Memory
 * Clamp a memory's content to max chars. String content is clamped in a fresh
 * memory; structured block content is left intact until token-aware
 * measurement lands. Does not mutate the input.
 * Pure
 * Private
 */
function _clamp_memory(memory: Memory, max: number): Memory {
  if ("string" === typeof memory.content) {
    return { ...memory, content: _clamp(memory.content, max, "history turn") };
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
