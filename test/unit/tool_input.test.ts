import { describe, it } from "node:test";
import * as assert from "node:assert/strict";

import {
  as_tool_input,
  as_string,
  as_number,
  as_integer,
  as_boolean,
  as_string_list,
  require_string,
  require_integer,
  require_string_list,
} from "#core/tool_input.js";
import type { Result } from "common";
import type { ToolOutcome } from "#core/tool.js";

/*
 * The rules a tool reads a model's arguments by. What is asserted here is
 * mostly the leniency: which sloppy-but-recoverable shapes are accepted, and
 * where acceptance stops and a failed call begins.
 */

describe("as_tool_input", () => {
  it("passes a plain object through", () => {
    assert.deepEqual(as_tool_input({ query: "x", limit: 3 }), { query: "x", limit: 3 });
  });

  it("turns anything that is not an argument map into an empty input", () => {
    // The tool then reports which arguments are missing, which is a better
    // failure than an adapter guessing at what was meant.
    for (const value of [null, undefined, "text", 7, true, ["a"]]) {
      assert.deepEqual(as_tool_input(value), {}, `for ${JSON.stringify(value)}`);
    }
  });
});

describe("as_string", () => {
  it("reads a string, including a blank one", () => {
    assert.equal(as_string("policy"), "policy");
    assert.equal(as_string("   "), "   ");
  });

  it("refuses to coerce a non-string", () => {
    for (const value of [42, true, null, undefined, {}, ["a"]]) {
      assert.equal(as_string(value), null, `for ${JSON.stringify(value)}`);
    }
  });
});

describe("as_number", () => {
  it("reads a finite number or a string that is entirely one", () => {
    assert.equal(as_number(12), 12);
    assert.equal(as_number(1.5), 1.5);
    assert.equal(as_number(-3), -3);
    assert.equal(as_number("1.50"), 1.5);
    assert.equal(as_number("  -12  "), -12);
  });

  it("rejects non-finite numbers and anything with trailing text", () => {
    for (const value of [NaN, Infinity, -Infinity, "12px", "1.2.3", "", true, null]) {
      assert.equal(as_number(value), null, `for ${String(value)}`);
    }
  });
});

describe("as_integer", () => {
  it("reads a whole number", () => {
    assert.equal(as_integer(8), 8);
    assert.equal(as_integer("8"), 8);
    assert.equal(as_integer("-8"), -8);
  });

  it("truncates a fractional number but not a fractional string", () => {
    assert.equal(as_integer(1.9), 1);
    assert.equal(as_integer(-1.9), -1);
    assert.equal(as_integer("1.5"), null);
  });

  it("rejects what it cannot read", () => {
    for (const value of [NaN, Infinity, "abc", "", true, null, undefined, {}]) {
      assert.equal(as_integer(value), null, `for ${String(value)}`);
    }
  });
});

describe("as_boolean", () => {
  it("reads a boolean or its spelled-out form, in any case", () => {
    assert.equal(as_boolean(true), true);
    assert.equal(as_boolean(false), false);
    assert.equal(as_boolean("true"), true);
    assert.equal(as_boolean(" FALSE "), false);
  });

  it("does not treat other values as truthiness", () => {
    for (const value of [1, 0, "yes", "no", "", null, undefined]) {
      assert.equal(as_boolean(value), null, `for ${String(value)}`);
    }
  });
});

describe("as_string_list", () => {
  it("reads a list of strings, trimming each", () => {
    assert.deepEqual(as_string_list(["a", " b "]), ["a", "b"]);
  });

  it("accepts a bare string as a one-element list", () => {
    assert.deepEqual(as_string_list("policy"), ["policy"]);
  });

  it("drops non-strings and blanks from a mixed list", () => {
    assert.deepEqual(as_string_list(["a", 7, "", "  ", null, "b"]), ["a", "b"]);
  });

  it("reads a list with nothing usable as absent rather than empty", () => {
    for (const value of [[], ["", "  "], [7, null], "   ", null, undefined, 42, {}]) {
      assert.equal(as_string_list(value), null, `for ${JSON.stringify(value)}`);
    }
  });
});

describe("require_string", () => {
  it("reads a present, non-blank string", () => {
    const read = require_string({ query: "whisper" }, "query");
    assert.deepEqual(read, { ok: true, value: "whisper" });
  });

  it("fails on missing, blank or mistyped, naming the parameter", () => {
    for (const input of [{}, { query: "   " }, { query: 42 }, { query: null }]) {
      const read = require_string(input, "query");
      assert.equal(read.ok, false, `for ${JSON.stringify(input)}`);
      assert.equal(
        read.ok ? "" : read.error,
        "'query' is required and must be a non-empty string.");
    }
  });
});

describe("require_integer", () => {
  it("reads a whole number", () => {
    assert.deepEqual(require_integer({ n: "4" }, "n"), { ok: true, value: 4 });
  });

  it("fails on a value it cannot read", () => {
    const read = require_integer({ n: "many" }, "n");
    assert.equal(read.ok ? "" : read.error, "'n' is required and must be a whole number.");
  });
});

describe("require_string_list", () => {
  it("reads a non-empty list", () => {
    assert.deepEqual(require_string_list({ ids: ["a"] }, "ids"), { ok: true, value: ["a"] });
  });

  it("fails on a list with nothing usable in it", () => {
    for (const input of [{}, { ids: [] }, { ids: 7 }, { ids: ["", " "] }]) {
      assert.equal(require_string_list(input, "ids").ok, false, `for ${JSON.stringify(input)}`);
    }
  });

  it("appends a tool's recovery hint to the standard message", () => {
    const read = require_string_list({}, "ids", { hint: "Use the ids returned by kg_search." });
    assert.equal(
      read.ok ? "" : read.error,
      "'ids' is required and must be a non-empty array of strings. "
      + "Use the ids returned by kg_search.");
  });
});

describe("ToolOutcome", () => {
  it("accepts a failed read straight out of a require_* reader", () => {
    const read: Result<string> = require_string({}, "query");
    const outcome: ToolOutcome = read;
    assert.equal(outcome.ok, false);
    assert.match(outcome.ok ? "" : outcome.error, /^'query' is required/);
  });
});
