import { describe, it } from "node:test";
import * as assert from "node:assert/strict";

import { make_grant_reviewer, GrantReviewMode } from "#bot/grant_reviewer.js";
import { MockModel } from "#model/mock.js";
import { GRANT_REVIEW_PROMPTS, branch, leaf } from "../support/prompts.ts";

describe("GrantReviewer (via MockModel)", () => {
  it("offers every review mode, named as its prompt names it", () => {
    const reviewer = make_grant_reviewer(new MockModel({ reply: "ok" }), GRANT_REVIEW_PROMPTS);
    for (const mode of Object.values(GrantReviewMode)) {
      assert.equal(reviewer.set_mode(mode), true, mode);
      assert.equal(reviewer.mode_prompt(), `Begin ${mode}.`);
    }
  });

  it("reviews under the composed mode with the documents filled in, opened by the mode's prompt", async () => {
    const mock = new MockModel({ reply: "ok" });
    const reviewer = make_grant_reviewer(mock, GRANT_REVIEW_PROMPTS);
    reviewer.set_mode(GrantReviewMode.SCORED);
    reviewer.set_context({ rfa: "the rfa", proposal: "the proposal" });

    await reviewer.review();

    const call = mock.calls()[0];
    assert.equal(
      call.opts.system_prompt,
      "Review scored.\n\nRFA:\nthe rfa\n\nProposal:\nthe proposal\n\nBe rigorous.");
    assert.deepEqual(call.memories, [{ role: "user", content: "Begin scored." }]);
  });

  it("refuses prompts missing a review mode", () => {
    const prompts = branch("Reviewer", "{mode}", { standard: leaf("Standard", "Only one.") });
    assert.throws(
      () => make_grant_reviewer(new MockModel({ reply: "ok" }), prompts),
      /no mode 'summary'/);
  });
});
