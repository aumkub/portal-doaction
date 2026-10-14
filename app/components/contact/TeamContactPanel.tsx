import { TEAM_CONTACT } from "~/lib/contact";
import { useT } from "~/lib/i18n";

export default function TeamContactPanel({
  className = "",
  showIntro = true,
}: {
  className?: string;
  showIntro?: boolean;
}) {
  const { t } = useT();

  return (
    <div className={className}>
      {showIntro ? (
        <div className="mb-4">
          <h2 className="text-[16px] font-semibold text-ink">{t("settings_contact_team_title")}</h2>
          <p className="text-[13px] text-muted-ink mt-1">{t("settings_contact_team_hint")}</p>
        </div>
      ) : null}
      <ul className="grid gap-2 sm:grid-cols-1">
        <li>
          <a
            href={TEAM_CONTACT.lineUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-between gap-3 min-h-12 rounded-2xl border border-line bg-white px-4 py-3 text-sm hover:bg-paper transition-colors"
          >
            <span className="font-medium text-ink">{t("settings_contact_line")}</span>
            <span className="text-muted-ink text-xs font-medium shrink-0">LINE →</span>
          </a>
        </li>
        <li>
          <a
            href={`tel:${TEAM_CONTACT.phoneTel}`}
            className="flex items-center justify-between gap-3 min-h-12 rounded-2xl border border-line bg-white px-4 py-3 text-sm hover:bg-paper transition-colors"
          >
            <span className="font-medium text-ink">{t("settings_contact_phone")}</span>
            <span className="text-ink-soft text-sm font-medium tabular-nums shrink-0">
              {TEAM_CONTACT.phoneDisplay}
            </span>
          </a>
        </li>
        <li>
          <a
            href={TEAM_CONTACT.facebookUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-between gap-3 min-h-12 rounded-2xl border border-line bg-white px-4 py-3 text-sm hover:bg-paper transition-colors"
          >
            <span className="font-medium text-ink">{t("settings_contact_facebook")}</span>
            <span className="text-muted-ink text-xs font-medium shrink-0">Facebook →</span>
          </a>
        </li>
        <li>
          <a
            href={`mailto:${TEAM_CONTACT.email}`}
            className="flex items-center justify-between gap-3 min-h-12 rounded-2xl border border-line bg-white px-4 py-3 text-sm hover:bg-paper transition-colors"
          >
            <span className="font-medium text-ink">{t("settings_contact_email")}</span>
            <span className="text-ink-soft text-sm font-medium break-all text-right">
              {TEAM_CONTACT.email}
            </span>
          </a>
        </li>
      </ul>
    </div>
  );
}
