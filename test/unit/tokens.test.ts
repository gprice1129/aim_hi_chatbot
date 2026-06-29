import { describe, it } from "node:test";
import * as assert from "node:assert/strict";

import { estimate_tokens, DEFAULT_CHARS_PER_TOKEN } from "#core/tokens.js";

describe("estimate_tokens", () => {
  it("estimates empty text as 0", () => {
    assert.equal(estimate_tokens(""), 0);
  });

  it("is monotonic non-decreasing in length", () => {
    let prev = 0;
    for (let n = 0; n <= 64; n++) {
      const tokens = estimate_tokens("x".repeat(n));
      assert.ok(tokens >= prev, `tokens decreased at length ${n}`);
      prev = tokens;
    }
  });

  it("uses the documented chars-per-token ratio", () => {
    assert.equal(estimate_tokens("x".repeat(DEFAULT_CHARS_PER_TOKEN)), 1);
    assert.equal(estimate_tokens("x".repeat(DEFAULT_CHARS_PER_TOKEN * 10)), 10);
  });

  it("rounds a partial token up", () => {
    assert.equal(estimate_tokens("x"), 1); // ceil(1/4) == 1
    assert.equal(estimate_tokens("x".repeat(DEFAULT_CHARS_PER_TOKEN + 1)), 2);
  });

  it("exposes a sane positive ratio", () => {
    assert.ok(DEFAULT_CHARS_PER_TOKEN >= 1);
  });
});
