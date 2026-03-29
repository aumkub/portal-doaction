import type { Route } from "./+types/contact";
import { requireUser } from "~/lib/auth.server";
import TeamContactPanel from "~/components/contact/TeamContactPanel";
import PageHeader from "~/components/layout/PageHeader";
import { useT } from "~/lib/i18n";

export function meta() {
  return [{ title: "ติดต่อทีม — DoAction Portal" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const env = context.cloudflare.env;
  await requireUser(request, env.DB, env.SESSIONPORTAL);
  return null;
}

export default function ClientContactPage() {
  const { t } = useT();

  return (
    <div className="space-y-6 max-w-2xl">
      <PageHeader
        title={t("settings_contact_team_title")}
        subtitle={t("settings_contact_team_hint")}
        breadcrumbs={[
          { label: t("nav_dashboard"), href: "/dashboard" },
          { label: t("nav_contact_team") },
        ]}
      />

      <section className="bg-white rounded-xl border border-slate-200 p-6">
        <TeamContactPanel showIntro={false} />
      </section>
    </div>
  );
}
