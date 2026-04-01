import { TEAM_CONTACT } from "~/lib/contact";
import { useT } from "~/lib/i18n";

/** LINE, phone, Facebook, email — used on /contact and dashboard. */
export default function TeamContactPanel({
  className = "",
  showIntro = true,
}: {
  className?: string;
  /** When false, omit title/hint (e.g. page already has PageHeader). */
  showIntro?: boolean;
}) {
  const { t } = useT();

  return (
    <div className={className}>
      {showIntro ? (
        <div className="mb-4">
          <h2 className="text-sm font-semibold text-slate-900">{t("settings_contact_team_title")}</h2>
          <p className="text-xs text-slate-500 mt-1">{t("settings_contact_team_hint")}</p>
        </div>
      ) : null}
      <ul className="grid gap-3 sm:grid-cols-1">
        <li>
          <a
            href={TEAM_CONTACT.lineUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 px-4 py-3 text-sm hover:border-violet-300 hover:bg-violet-50/40 transition-colors"
          >
            <span className="font-medium text-slate-800">{t("settings_contact_line")}</span>
            <span className="text-violet-600 text-xs font-semibold shrink-0">LINE →</span>
          </a>
        </li>
        <li>
          <a
            href={`tel:${TEAM_CONTACT.phoneTel}`}
            className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 px-4 py-3 text-sm hover:border-violet-300 hover:bg-violet-50/40 transition-colors"
          >
            <span className="font-medium text-slate-800">{t("settings_contact_phone")}</span>
            <span className="text-slate-600 text-sm font-medium tabular-nums shrink-0">
              {TEAM_CONTACT.phoneDisplay}
            </span>
          </a>
        </li>
        <li>
          <a
            href={TEAM_CONTACT.facebookUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 px-4 py-3 text-sm hover:border-violet-300 hover:bg-violet-50/40 transition-colors"
          >
            <span className="font-medium text-slate-800">{t("settings_contact_facebook")}</span>
            <span className="text-violet-600 text-xs font-semibold shrink-0">Facebook →</span>
          </a>
        </li>
        <li>
          <a
            href={`mailto:${TEAM_CONTACT.email}`}
            className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 px-4 py-3 text-sm hover:border-violet-300 hover:bg-violet-50/40 transition-colors"
          >
            <span className="font-medium text-slate-800">{t("settings_contact_email")}</span>
            <span className="text-slate-600 text-sm font-medium break-all text-right">
              {TEAM_CONTACT.email}
            </span>
          </a>
        </li>
      </ul>
    </div>
  );
}
