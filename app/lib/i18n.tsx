import {
  createContext,
  useContext,
  useState,
  useEffect,
  type ReactNode,
} from "react";
import { translations, type Lang, type TranslationKey } from "./translations";

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

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>("th");

  useEffect(() => {
    const saved = localStorage.getItem("portal_lang") as Lang;
    if (saved === "th" || saved === "en") setLangState(saved);
  }, []);

  const setLang = (newLang: Lang) => {
    setLangState(newLang);
    localStorage.setItem("portal_lang", newLang);
  };

  const t = (key: TranslationKey): string =>
    translations[lang][key] ?? translations.th[key] ?? key;

  return (
    <I18nContext.Provider value={{ lang, setLang, t }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useT() {
  return useContext(I18nContext);
}

/** Small button for the Topbar */
export function LanguageSwitcher() {
  const { lang, setLang } = useT();
  return (
    <button
      type="button"
      onClick={() => setLang(lang === "th" ? "en" : "th")}
      className="h-8 px-2.5 rounded-lg border border-slate-200 text-xs font-semibold text-slate-600 hover:bg-slate-100 transition-colors focus:outline-none"
      title={lang === "th" ? "Switch to English" : "เปลี่ยนเป็นภาษาไทย"}
    >
      {lang === "th" ? "EN" : "TH"}
    </button>
  );
}
