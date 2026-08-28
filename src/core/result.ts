export { BotFailure };
export type { BotReply, BotError };

import type { Result } from "common";

/*
 * How a bot turn reports what became of it.
 *
 * The failure arm carries a reason from a fixed set plus whatever threw
 * underneath because a host has to decide what to show a person.
 */

// Represents reasons for a bot's failure to generate a response
enum BotFailure {
  UNAVAILABLE = "unavailable", // provider call threw: network / 429 / 5xx / timeout
  INCOMPLETE  = "incomplete",  // model produced no usable completion
  TOOL_LIMIT  = "tool_limit",  // model kept calling tools past the round cap
}

// Why a bot turn failed.
interface BotError {
  failure: BotFailure;
  cause?: unknown;
}

type BotReply = Result<string[], BotError>;
