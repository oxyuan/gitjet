import { createContext, useCallback, useContext } from "react";

/** The languages GitJet ships with. */
export type Lang = "en" | "zh";

/** A dictionary module: the same keys in every language. */
export type Dict = { en: Record<string, string>; zh: Record<string, string> };

const Context = createContext<Lang>("en");

/**
 * resolveLang maps the settings value to a language: "system" follows the
 * webview's locale, anything else is the language itself.
 */
export function resolveLang(setting: string): Lang {
  if (setting === "en" || setting === "zh") return setting;
  const locale = typeof navigator === "undefined" ? "" : navigator.language;
  return locale.toLowerCase().startsWith("zh") ? "zh" : "en";
}

export function LangProvider({ lang, children }: { lang: Lang; children: React.ReactNode }) {
  return <Context.Provider value={lang}>{children}</Context.Provider>;
}

/** useLang returns the language in effect. */
export function useLang(): Lang {
  return useContext(Context);
}

/**
 * useT translates a dictionary defined next to the component that uses it.
 * Placeholders look like "{count}" and are filled from vars.
 */
export function useT<D extends Dict>(dict: D) {
  const lang = useLang();
  return useCallback(
    (key: keyof D["en"] & string, vars?: Record<string, string | number>) => {
      let text = dict[lang][key] ?? dict.en[key] ?? key;
      if (vars) {
        for (const [name, value] of Object.entries(vars)) {
          text = text.split(`{${name}}`).join(String(value));
        }
      }
      return text;
    },
    [dict, lang],
  );
}

/**
 * plural picks the form for a count: dictionaries key a suffix `_one` or
 * `_other` after the base key.
 */
export function count(n: number, one: string, other: string): string {
  return n === 1 ? one : other;
}
