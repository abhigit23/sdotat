import { describe, expect, it } from "vitest";
import { createLowlight, common } from "lowlight";
import type { ElementContent } from "hast";
import { detectLanguage, highlight, splitLines } from "./highlight";
import { LANGUAGES } from "./languages";

/** The text a list of hast nodes renders as. */
function textOf(nodes: ElementContent[]): string {
  return nodes
    .map((n) => (n.type === "text" ? n.value : n.type === "element" ? textOf(n.children) : ""))
    .join("");
}

describe("languages", () => {
  it("lists only languages the highlighter has", () => {
    const known = new Set(createLowlight(common).listLanguages());
    for (const { value } of LANGUAGES) expect(known.has(value)).toBe(true);
  });
});

describe("detectLanguage", () => {
  it.each([
    ["python", "def foo(x):\n    return [i*2 for i in range(x)]\n\nclass A:\n    pass\n"],
    ["javascript", "const a = await fetch(url);\nexport function f(x) { return x?.y ?? 1; }\n"],
    ["sql", "SELECT id, name FROM users WHERE created_at > now() ORDER BY id;"],
    ["bash", "#!/bin/bash\nset -euo pipefail\nfor f in *.log; do\n  gzip \"$f\"\ndone\n"],
  ])("detects %s", (language, text) => {
    expect(detectLanguage(text)).toBe(language);
  });

  it("never guesses VB.NET, a common false positive", () => {
    expect(detectLanguage("Hi team, the meeting moved to 3pm tomorrow.")).not.toBe("vbnet");
  });

  it("returns null when nothing matches", () => {
    expect(detectLanguage("")).toBeNull();
  });
});

describe("splitLines", () => {
  const ll = createLowlight(common);

  it("keeps one entry per source line, with the same text", () => {
    const source = "/* a\n   multi-line\n   comment */\nconst x = `a\nb`;\n\nlet y = 1;";
    const nodes = ll.highlight("javascript", source).children as ElementContent[];
    const lines = splitLines(nodes);
    expect(lines.map(textOf)).toEqual(source.split("\n"));
  });

  it("re-wraps tokens that span lines", () => {
    const nodes = ll.highlight("javascript", "/* a\nb */").children as ElementContent[];
    const [first, second] = splitLines(nodes);
    for (const line of [first, second]) {
      const el = line[0];
      expect(el.type === "element" && el.properties.className).toEqual(["hljs-comment"]);
    }
  });
});

describe("highlight", () => {
  it("returns a node per line", () => {
    const text = "a = 1\nb = 2\n";
    expect(highlight(text, "python").lines).toHaveLength(text.split("\n").length);
  });
});
