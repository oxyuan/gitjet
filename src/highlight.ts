import Prism from "prismjs";
import "prismjs/components/prism-typescript";
import "prismjs/components/prism-jsx";
import "prismjs/components/prism-tsx";
import "prismjs/components/prism-go";
import "prismjs/components/prism-json";
import "prismjs/components/prism-markdown";
import "prismjs/components/prism-python";
import "prismjs/components/prism-bash";
import "prismjs/components/prism-yaml";
import "prismjs/components/prism-java";
import "prismjs/components/prism-kotlin";
import "prismjs/components/prism-rust";
import "prismjs/components/prism-c";
import "prismjs/components/prism-cpp";
import "prismjs/components/prism-sql";
import "prismjs/components/prism-scss";
import "prismjs/components/prism-toml";
import "prismjs/components/prism-ruby";
import "prismjs/components/prism-php";
import "prismjs/components/prism-swift";
import "prismjs/components/prism-docker";
import "prismjs/components/prism-makefile";

/** Highlights one line of code. Multi-line constructs keep the token style
 *  of the line where they start, which is enough for a review pane. */
export function highlightLine(line: string, language: string): string {
  const grammar = Prism.languages[language];
  if (!grammar || line.length > 20000) return escapeHTML(line);
  try {
    return Prism.highlight(line, grammar, language);
  } catch {
    return escapeHTML(line);
  }
}

export function escapeHTML(text: string): string {
  return text.replace(/[&<>"']/g, (c) =>
    c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : c === '"' ? "&quot;" : "&#39;",
  );
}
