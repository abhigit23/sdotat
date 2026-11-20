// Syntax highlighting for the viewer. Imported dynamically, so the grammars
// only download once a paste is shown.

import { createLowlight, common } from "lowlight";
import type { ElementContent, Root } from "hast";
import { toJsxRuntime } from "hast-util-to-jsx-runtime";
import { Fragment, jsx, jsxs } from "react/jsx-runtime";
import type { ReactNode } from "react";
import { LANGUAGES } from "./languages";

const lowlight = createLowlight(common);

/** Detection only looks at the start: it's ~15x slower than highlighting. */
const DETECT_SAMPLE_CHARS = 10_000;

/**
 * Languages detection may pick: the toolbar's, minus VB.NET, which wins on
 * all sorts of plain text. It can still be chosen by hand.
 */
const DETECTABLE: string[] = LANGUAGES.map((l) => l.value).filter(
  (l) => l !== "vbnet"
);

/**
 * highlight.js's best guess at the language of `text`, or null if nothing
 * matched at all. Only a guess: its score can't tell short code from prose
 * (long prose easily "matches" SQL), so it runs only when the reader asks,
 * and the toolbar shows the result so they can correct it.
 */
export function detectLanguage(text: string): string | null {
  const sample = text.slice(0, DETECT_SAMPLE_CHARS);
  const { data } = lowlight.highlightAuto(sample, { subset: DETECTABLE });
  return data?.language && (data.relevance ?? 0) > 0 ? data.language : null;
}

/**
 * Splits highlighted nodes into one list per line of the source, re-wrapping
 * each piece in its enclosing token elements. Tokens such as block comments
 * can span lines; numbered view needs every line as its own row.
 */
export function splitLines(nodes: ElementContent[]): ElementContent[][] {
  const lines: ElementContent[][] = [[]];
  for (const node of nodes) {
    if (node.type === "text") {
      node.value.split("\n").forEach((part, i) => {
        if (i > 0) lines.push([]);
        if (part) lines[lines.length - 1].push({ type: "text", value: part });
      });
    } else if (node.type === "element") {
      splitLines(node.children).forEach((children, i) => {
        if (i > 0) lines.push([]);
        if (children.length > 0) {
          lines[lines.length - 1].push({ ...node, children });
        }
      });
    }
  }
  return lines;
}

function render(children: ElementContent[]): ReactNode {
  const root: Root = { type: "root", children };
  // Builds React elements from the token tree: text stays text (escaped by
  // React), and lowlight only emits <span class="hljs-..."> elements.
  return toJsxRuntime(root, { Fragment, jsx, jsxs });
}

export type Highlighted = {
  /** The whole text, for the plain (unnumbered) view. */
  all: ReactNode;
  /** One entry per line, for the numbered view. */
  lines: ReactNode[];
};

/** Highlights `text` as `language` (a highlight.js language id). */
export function highlight(text: string, language: string): Highlighted {
  const tree = lowlight.highlight(language, text);
  const children = tree.children as ElementContent[];
  return { all: render(children), lines: splitLines(children).map(render) };
}
