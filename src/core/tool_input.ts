export {
  as_tool_input,
  as_string,
  as_number,
  as_integer,
  as_boolean,
  as_string_list,
  require_string,
  require_integer,
  require_string_list,
}
export type {
  ReadOpts,
}

import type { ToolInput } from "#core/tool.js";
import {
  is_object,
  is_string,
  is_number,
  is_boolean,
  is_missing,
  type Result,
} from "common";

/*
 * Main Concept
 * -----------------------------------------------------------------------------
 * This file defines how arguments written by a model are read. Arguments are
 * considered untrusted. Reading either yields a usable value or explains, in
 * terms a model can act on, why no value could be read.
 */

/*
 * Application Usage
 * -----------------------------------------------------------------------------
 * No code between a model and a Tool checks a ToolCall's arguments. A
 * ToolRegistry dispatches by name. A ToolSchema travels outward only. Each Tool
 * therefore validates its own arguments, and each Tool uses this module to do
 * so. The coercion rules and the failure messages are written once here.
 *
 * This module exposes two families of reader. An as_* reader mirrors one
 * ToolParamType and returns null when a value cannot be read as that type, so a
 * caller can supply a fallback. A require_* reader wraps an as_* reader and
 * adds a failure message and returns a Result. A ToolOutcome is a Result, so a
 * Tool returns a failed read unchanged.
 */

/*
 * Idea: Per-read options.
 *
 * `hint` appends tool-specific recovery advice to a failure message, for
 * pointing at where a good value comes from.
 */
interface ReadOpts {
  hint?: string;
}

/*
 * Idea: Interpret as the full tool call input map.
 *
 * The only reader here that never fails. Anything that is not a plain object
 * becomes an empty input, and the tool reports the missing arguments.
 *
 * (unknown) => ToolInput
 * Pure
 * Public
 */
function as_tool_input(value: unknown): ToolInput {
  if (!is_object(value)) return {};
  return value;
}

/*
 * Idea: Attempt to interpret as a string.
 *
 * (unknown) => string | null
 * Pure
 * Public
 */
function as_string(value: unknown): string | null {
  if (!is_string(value)) return null;
  return value;
}

/*
 * Idea: Attempt to interpret as a finite real number.
 *
 * A string that is entirely a number is accepted. NaN and Infinity are not.
 *
 * (unknown) => number | null
 * Pure
 * Public
 */
function as_number(value: unknown): number | null {
  if (is_number(value) && Number.isFinite(value)) return value;
  if (is_string(value) && /^-?\d+(\.\d+)?$/.test(value.trim())) {
    return Number(value.trim());
  }
  return null;
}

/*
 * Idea: Attempt to interpret as a finite integer.
 *
 * A fractional number is truncated. A fractional string is not.
 *
 * (unknown) => number | null
 * Pure
 * Public
 */
function as_integer(value: unknown): number | null {
  if (is_number(value) && Number.isFinite(value)) return Math.trunc(value);
  if (is_string(value) && /^-?\d+$/.test(value.trim())) return Number(value.trim());
  return null;
}

/*
 * Idea: Attempt to interpret as a boolean.
 *
 * (unknown) => boolean | null
 * Pure
 * Public
 */
function as_boolean(value: unknown): boolean | null {
  if (is_boolean(value)) return value;
  if (is_string(value)) {
    const text = value.trim().toLowerCase();
    if ("true" === text) return true;
    if ("false" === text) return false;
  }
  return null;
}

/*
 * Idea: Attempt to interpret as a list of strings.
 *
 * A bare string is accepted as a one-element list because models routinely send
 * `"type": "policy"` for an array parameter. 
 *
 * (unknown) => string[] | null
 * Pure
 * Public
 */
function as_string_list(value: unknown): string[] | null {
  if (is_missing(value)) return null;
  if (is_string(value)) {
    const single = value.trim();
    if ("" === single) return null;
    return [single];
  }
  if (!Array.isArray(value)) return null;
  const items = value
    .filter(is_string)
    .map((item) => item.trim())
    .filter((item) => "" !== item);
  if (0 === items.length) return null;
  return items;
}

/*
 * Idea: Demand a present, non-blank string.
 *
 * (ToolInput, string, ReadOpts) => Result<string>
 * Pure
 * Public
 */
function require_string(
    input: ToolInput, name: string, opts: ReadOpts = {}): Result<string> {
  const value = as_string(input[name]);
  if (null === value || "" === value.trim()) {
    return { ok: false, error: _expected(name, "a non-empty string", opts) };
  }
  return { ok: true, value };
}

/*
 * Idea: Demand a whole number.
 *
 * (ToolInput, string, ReadOpts) => Result<number>
 * Pure
 * Public
 */
function require_integer(
    input: ToolInput, name: string, opts: ReadOpts = {}): Result<number> {
  const value = as_integer(input[name]);
  if (null === value) {
    return { ok: false, error: _expected(name, "a whole number", opts) };
  }
  return { ok: true, value };
}

/*
 * Idea: Demand a list holding at least one usable string.
 *
 * (ToolInput, string, ReadOpts) => Result<string[]>
 * Pure
 * Public
 */
function require_string_list(
    input: ToolInput, name: string, opts: ReadOpts = {}): Result<string[]> {
  const value = as_string_list(input[name]);
  if (null === value) {
    return { ok: false, error: _expected(name, "a non-empty array of strings", opts) };
  }
  return { ok: true, value };
}

/*
 * Idea: Generate a standard error message that is usable by a model.
 *
 * (string, string, ReadOpts) => string
 * Pure
 * Private
 */
function _expected(name: string, expected: string, opts: ReadOpts): string {
  const hint = undefined === opts.hint ? "" : ` ${opts.hint}`;
  return `'${name}' is required and must be ${expected}.${hint}`;
}
