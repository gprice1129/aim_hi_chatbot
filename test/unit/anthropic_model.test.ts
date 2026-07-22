import { describe, it } from "node:test";
import * as assert from "node:assert/strict";

import {
  AnthropicModel,
  AnthropicModelType,
  AnthropicModelEffortScale,
  AnthropicModelThinkingMode,
  AnthropicModelCacheTtl,
} from "#model/anthropic.js";
import type { Endpoint } from "#core/types.js";

// validate_config is private to the module; these tests exercise it through
// its two public entry points: the constructor (construction-time defaults)
// and gen_message (the merged per-call config). Every rejection throws before
// any network I/O, so no API endpoint is contacted.
const ENDPOINT: Endpoint = { api_key: "test-key", base_url: "http://localhost" };

describe("AnthropicModel config validation at construction", () => {
  it("accepts a config with all optional parameters unset on every model", () => {
    for (const type of Object.values(AnthropicModelType)) {
      new AnthropicModel(ENDPOINT, type, null, 1024);
    }
  });

  it("accepts adaptive thinking, effort, and caching on Opus", () => {
    new AnthropicModel(
      ENDPOINT, AnthropicModelType.Opus,
      AnthropicModelEffortScale.Max, 16384,
      { type: AnthropicModelThinkingMode.Adaptive },
      AnthropicModelCacheTtl.OneHour);
  });

  it("accepts a budgeted thinking config on Haiku", () => {
    new AnthropicModel(
      ENDPOINT, AnthropicModelType.Haiku, null, 2048,
      { type: AnthropicModelThinkingMode.Enabled, budget_tokens: 1024 });
  });

  it("accepts a budgeted thinking config on Sonnet (deprecated escape hatch)", () => {
    new AnthropicModel(
      ENDPOINT, AnthropicModelType.Sonnet, null, 4096,
      { type: AnthropicModelThinkingMode.Enabled, budget_tokens: 2048 });
  });

  it("accepts explicitly disabled thinking on every model", () => {
    for (const type of Object.values(AnthropicModelType)) {
      new AnthropicModel(
        ENDPOINT, type, null, 1024,
        { type: AnthropicModelThinkingMode.Disabled });
    }
  });

  it("rejects effort on Haiku", () => {
    assert.throws(
      () => new AnthropicModel(
        ENDPOINT, AnthropicModelType.Haiku, AnthropicModelEffortScale.Low, 1024),
      /rejects the effort parameter/);
  });

  it("rejects adaptive thinking on Haiku", () => {
    assert.throws(
      () => new AnthropicModel(
        ENDPOINT, AnthropicModelType.Haiku, null, 2048,
        { type: AnthropicModelThinkingMode.Adaptive }),
      /does not support adaptive thinking/);
  });

  it("rejects budgeted thinking on Opus", () => {
    assert.throws(
      () => new AnthropicModel(
        ENDPOINT, AnthropicModelType.Opus, null, 16384,
        { type: AnthropicModelThinkingMode.Enabled, budget_tokens: 8192 }),
      /rejects budget_tokens thinking/);
  });

  it("rejects a thinking budget below the API floor", () => {
    assert.throws(
      () => new AnthropicModel(
        ENDPOINT, AnthropicModelType.Sonnet, null, 2048,
        { type: AnthropicModelThinkingMode.Enabled, budget_tokens: 512 }),
      /budget_tokens must be >= 1024/);
  });

  it("rejects a thinking budget that meets or exceeds max_tokens", () => {
    assert.throws(
      () => new AnthropicModel(
        ENDPOINT, AnthropicModelType.Haiku, null, 1024,
        { type: AnthropicModelThinkingMode.Enabled, budget_tokens: 1024 }),
      /must be < max_tokens/);
  });

  it("rejects non-positive and non-integer max_tokens", () => {
    for (const max_tokens of [0, -1, 1.5]) {
      assert.throws(
        () => new AnthropicModel(
          ENDPOINT, AnthropicModelType.Haiku, null, max_tokens),
        /max_tokens must be a positive integer/);
    }
  });
});

describe("AnthropicModel config validation of per-call opts", () => {
  it("rejects opts that override into an invalid combination", async () => {
    // Valid at construction; the per-call effort makes the merge invalid.
    const model = new AnthropicModel(ENDPOINT, AnthropicModelType.Haiku, null, 2048);
    await assert.rejects(
      model.gen_message([], { effort: AnthropicModelEffortScale.Low }),
      /rejects the effort parameter/);
  });

  it("validates the merged config, not the opts alone", async () => {
    // Constructor budget (1024) is valid against its max_tokens (2048); the
    // per-call max_tokens shrinks the cap below the standing budget.
    const model = new AnthropicModel(
      ENDPOINT, AnthropicModelType.Haiku, null, 2048,
      { type: AnthropicModelThinkingMode.Enabled, budget_tokens: 1024 });
    await assert.rejects(
      model.gen_message([], { max_tokens: 1024 }),
      /must be < max_tokens/);
  });

  it("rejects a per-call thinking config the model does not support", async () => {
    const model = new AnthropicModel(ENDPOINT, AnthropicModelType.Haiku, null, 2048);
    await assert.rejects(
      model.gen_message([], { thinking: { type: AnthropicModelThinkingMode.Adaptive } }),
      /does not support adaptive thinking/);
  });
});
