import { HighlightStyle } from "@codemirror/language";
import { tagHighlighter, tags as t, type Highlighter, type Tag } from "@lezer/highlight";

/** One token class: the tags it covers, the CSS class the diff paints with,
 *  and the colours the editor paints with. The two must agree — a keyword is
 *  the same colour in the source pane and in the diff of that source. */
export interface TokenRule {
  tags: Tag | readonly Tag[];
  cls: string;
  style: { color: string; fontStyle?: "italic"; fontWeight?: string; textDecoration?: string };
}

/** The single palette both renderers use. Adding a token here is the whole
 *  change: the editor's HighlightStyle and the diff's class highlighter are
 *  both derived from this list. */
export const tokenRules: TokenRule[] = [
  {
    tags: [t.keyword, t.modifier, t.operatorKeyword],
    cls: "tok-keyword",
    style: { color: "var(--syntax-keyword)" },
  },
  {
    tags: [t.string, t.special(t.string)],
    cls: "tok-string",
    style: { color: "var(--syntax-string)" },
  },
  {
    tags: [t.number, t.bool, t.null],
    cls: "tok-number",
    style: { color: "var(--syntax-number)" },
  },
  {
    tags: [t.comment, t.lineComment, t.blockComment],
    cls: "tok-comment",
    style: { color: "var(--syntax-comment)", fontStyle: "italic" },
  },
  {
    tags: [t.function(t.variableName), t.function(t.propertyName)],
    cls: "tok-function",
    style: { color: "var(--syntax-function)" },
  },
  {
    tags: [t.typeName, t.className, t.namespace],
    cls: "tok-type",
    style: { color: "var(--syntax-tag)" },
  },
  {
    tags: [t.propertyName, t.attributeName],
    cls: "tok-property",
    style: { color: "var(--syntax-variable)" },
  },
  {
    tags: [t.variableName, t.labelName],
    cls: "tok-variable",
    style: { color: "var(--syntax-punct)" },
  },
  {
    tags: [t.tagName],
    cls: "tok-tag",
    style: { color: "var(--syntax-keyword)" },
  },
  {
    tags: [t.meta, t.annotation],
    cls: "tok-meta",
    style: { color: "var(--syntax-comment)" },
  },
  {
    tags: [t.heading],
    cls: "tok-heading",
    style: { color: "var(--syntax-tag)", fontWeight: "600" },
  },
  {
    tags: [t.link, t.url],
    cls: "tok-link",
    style: { color: "var(--syntax-function)", textDecoration: "underline" },
  },
  {
    tags: [t.operator, t.punctuation, t.bracket, t.separator],
    cls: "tok-operator",
    style: { color: "var(--syntax-operator)" },
  },
];

/** The editor's highlighter, built from the shared rules. */
export const editorHighlightStyle = HighlightStyle.define(
  tokenRules.map((rule) => ({ tag: rule.tags, ...rule.style })),
);

/** The diff's highlighter: same tags, class names the stylesheet colours. */
export const classHighlighter: Highlighter = tagHighlighter(
  tokenRules.map((rule) => ({ tag: rule.tags, class: rule.cls })),
);
