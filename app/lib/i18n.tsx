import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useMemo,
  type ReactNode,
} from "react";
import { useFetcher, useRevalidator } from "react-router";
import { translations, type Lang, type TranslationKey } from "./translations";

/** Same as `Lang` — exported for server routes and DB types */
export type Language = Lang;

export function resolveLanguage(language: unknown): Language {
  return language === "en" ? "en" : "th";
}

export function getLanguageFromCookieHeader(
  cookieHeader: string | null
): Language | null {
  if (!cookieHeader) return null;
  const match = cookieHeader.match(/(?:^|;\s*)doaction_lang=(th|en)(?:;|$)/);
  return match ? resolveLanguage(match[1]) : null;
}

export function createLanguageCookie(language: Language): string {
  return `doaction_lang=${language}; Path=/; Max-Age=31536000; SameSite=Lax`;
}

interface I18nContextType {
  lang: Lang;
  setLang: (lang: Lang) => void;
  t: (key: TranslationKey) => string;
}

const I18nContext = createContext<I18nContextType>({
  lang: "th",
  setLang: () => {},
  t: (key) => translations.th[key],
});

export function I18nProvider({
  children,
  initialLang = "th",
}: {
  children: ReactNode;
  initialLang?: Lang;
}) {
  const [lang, setLangState] = useState<Lang>(initialLang);

  useEffect(() => {
    setLangState(initialLang);
  }, [initialLang]);

  const setLang = useCallback((newLang: Lang) => {
    setLangState(newLang);
  }, []);

  const t = useMemo(
    () =>
      (key: TranslationKey): string =>
        translations[lang][key] ?? translations.th[key] ?? key,
    [lang]
  );

  const value = useMemo(() => ({ lang, setLang, t }), [lang, setLang, t]);

  return (
    <I18nContext.Provider value={value}>
      {children}
    </I18nContext.Provider>
  );
}

export function useT() {
  return useContext(I18nContext);
}

type LanguageActionData = { ok?: boolean; language?: Lang };

/** Small button for the Topbar — persists language (cookie + DB) via POST /api/language */
export function LanguageSwitcher() {
  const { lang, setLang } = useT();
  const fetcher = useFetcher<LanguageActionData>();
  const revalidator = useRevalidator();

  useEffect(() => {
    if (fetcher.state !== "idle" || !fetcher.data?.ok || !fetcher.data.language) return;
    setLang(fetcher.data.language);
    revalidator.revalidate();
  }, [fetcher.state, fetcher.data, setLang, revalidator]);

  const busy = fetcher.state !== "idle";

  return (
    <button
      type="button"
      disabled={busy}
      onClick={() => {
        const next = lang === "th" ? "en" : "th";
        fetcher.submit({ language: next }, { method: "post", action: "/api/language" });
      }}
      className="h-8 px-2.5 rounded-lg border border-slate-200 text-xs font-semibold text-slate-600 hover:bg-slate-100 transition-colors focus:outline-none disabled:opacity-50"
      title={lang === "th" ? "Switch to English" : "เปลี่ยนเป็นภาษาไทย"}
    >
      {lang === "th" ? "EN" : "TH"}
    </button>
  );
}
