export { BotFailure };
export type { BotReply };

// Represents reasons for a bot's failure to generate a response
enum BotFailure {
  UNAVAILABLE = "unavailable", // provider call threw: network / 429 / 5xx / timeout
  INCOMPLETE  = "incomplete",  // model produced no usable completion
}

// Discriminated result for a bot turn
type BotReply =
  | { ok: true;  content: string[] }
  | { ok: false; failure: BotFailure; cause?: unknown };
