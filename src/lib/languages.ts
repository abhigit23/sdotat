// Languages offered by the viewer's syntax highlighting. Kept free of imports
// so the toolbar can list them without loading the highlighter. Every value
// is a language in lowlight's `common` set (checked in highlight.test.ts).

export const LANGUAGES = [
  { value: "bash", label: "Bash" },
  { value: "c", label: "C" },
  { value: "cpp", label: "C++" },
  { value: "csharp", label: "C#" },
  { value: "css", label: "CSS" },
  { value: "diff", label: "Diff" },
  { value: "go", label: "Go" },
  { value: "graphql", label: "GraphQL" },
  { value: "xml", label: "HTML / XML" },
  { value: "ini", label: "INI / TOML" },
  { value: "java", label: "Java" },
  { value: "javascript", label: "JavaScript" },
  { value: "json", label: "JSON" },
  { value: "kotlin", label: "Kotlin" },
  { value: "less", label: "Less" },
  { value: "lua", label: "Lua" },
  { value: "makefile", label: "Makefile" },
  { value: "markdown", label: "Markdown" },
  { value: "objectivec", label: "Objective-C" },
  { value: "perl", label: "Perl" },
  { value: "php", label: "PHP" },
  { value: "python", label: "Python" },
  { value: "r", label: "R" },
  { value: "ruby", label: "Ruby" },
  { value: "rust", label: "Rust" },
  { value: "scss", label: "SCSS" },
  { value: "shell", label: "Shell session" },
  { value: "sql", label: "SQL" },
  { value: "swift", label: "Swift" },
  { value: "typescript", label: "TypeScript" },
  { value: "vbnet", label: "VB.NET" },
  { value: "yaml", label: "YAML" },
] as const;

export type LanguageChoice = "auto" | "plain" | (typeof LANGUAGES)[number]["value"];

/** Display name for a highlight.js language id, e.g. "cpp" → "C++". */
export function languageLabel(value: string): string {
  return LANGUAGES.find((l) => l.value === value)?.label ?? value;
}

/**
 * Above this many characters text isn't highlighted: building and rendering
 * the token tree would make a phone stall.
 */
export const MAX_HIGHLIGHT_CHARS = 200_000;
