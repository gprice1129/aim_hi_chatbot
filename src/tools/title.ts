export {
  SetTitleTool,
  SET_TITLE,
  TITLE_MAX_LENGTH,
}
export type {
  SessionTitle,
}

import {
  ToolParamType,
  type Tool,
  type ToolInput,
  type ToolOutcome,
  type ToolSchema,
} from "#core/tool.js";
import { require_string } from "#core/tool_input.js";

/*
 * Main Concept
 * -----------------------------------------------------------------------------
 * The one way a model names the session it is writing in. A session starts
 * under a placeholder title; once the model knows what the document is about
 * it may give the session a short name, unless the user has already named it
 * themselves. The tool holds the name for the reply it serves; whoever built
 * it reads the name back and persists it.
 */

const SET_TITLE = "set_title";

// Long enough for a descriptive name, short enough for a session list.
const TITLE_MAX_LENGTH = 80;

/*
 * Idea: The session's title as the turn begins.
 *
 * `locked` is true when the user named the session themselves: the model may
 * then suggest nothing, and the tool tells it so.
 */
interface SessionTitle {
  title: string;
  locked: boolean;
}

class SetTitleTool implements Tool {
  public readonly name = SET_TITLE;
  public readonly description: string;
  public readonly schema: ToolSchema;

  private _current: SessionTitle;
  private _title: string | null;

  constructor(current: SessionTitle) {
    this._current = current;
    this._title = null;
    this.description =
      "Name the session the user sees above this conversation. Call it once "
      + "you know what the document is about, with a short, descriptive name "
      + "reminiscent of the study's title, and again if the study's focus "
      + "changes. Keep it short: a few words, not the full title. If the user "
      + "has named the session themselves it keeps their name, and this tool "
      + "tells you so.";
    this.schema = {
      properties: {
        title: {
          type: ToolParamType.String,
          description: `The session's new name, at most ${TITLE_MAX_LENGTH} characters.`,
        },
      },
      required: ["title"],
    };
  }

  /*
   * (void) => string | null
   * The name the model gave the session, or null when it gave none or the
   * session is the user's to name.
   * Pure
   * Public
   */
  public title(): string | null {
    return this._title;
  }

  /*
   * (ToolInput) => ToolOutcome
   * Side Effect: holds the name for the host to persist
   * Public
   */
  public async run(input: ToolInput): Promise<ToolOutcome> {
    const raw = require_string(input, "title");
    if (!raw.ok) return raw;
    const title = raw.value.replace(/\s+/g, " ").trim();
    if (TITLE_MAX_LENGTH < title.length) {
      return {
        ok: false,
        error: `'title' must be at most ${TITLE_MAX_LENGTH} characters; this one is ${title.length}. Shorten it.`,
      };
    }
    if (this._current.locked) {
      return {
        ok: true,
        value: `The user named this session "${this._current.title}" themselves, so it keeps that name.`,
      };
    }
    if (title === this._current.title) {
      return { ok: true, value: `The session is already named "${title}".` };
    }
    this._title = title;
    return { ok: true, value: `Named the session "${title}". The user can see it now.` };
  }
}
