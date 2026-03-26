import type { Route } from "./+types/reports-list";
import { requireUser } from "~/lib/auth.server";
import { createDB } from "~/lib/db.server";
import ReportCard from "~/components/reports/ReportCard";
import PageHeader from "~/components/layout/PageHeader";
import type { MonthlyReport } from "~/types";

export function meta() {
  return [{ title: "รายงานประจำเดือน — DoAction Portal" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const env = context.cloudflare.env;
  const user = await requireUser(request, env.DB, env.SESSIONPORTAL);
  const db = createDB(env.DB);
  const client = await db.getClientByUserId(user.id);
  if (!client) return { reports: [] };

  const reports = await db.listReportsByClient(client.id);
  return { reports: reports.filter((r) => r.status === "published") };
}

export default function ReportsListPage({ loaderData }: Route.ComponentProps) {
  const { reports } = loaderData as { reports: MonthlyReport[] };

  return (
    <div className="space-y-6">
      <PageHeader
        title="รายงานประจำเดือน"
        subtitle="สรุปงานที่ทีมดำเนินการในแต่ละเดือน"
        breadcrumbs={[{ label: "Dashboard", href: "/dashboard" }, { label: "Reports" }]}
      />

      {reports.length === 0 ? (
        <div className="bg-white rounded-xl border border-slate-200 p-16 text-center">
          <p className="text-4xl mb-3">📋</p>
          <p className="text-slate-600 font-medium">ยังไม่มีรายงาน</p>
          <p className="text-slate-400 text-sm mt-1">
            ทีมจะเผยแพร่รายงานหลังสิ้นสุดแต่ละเดือน
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {reports.map((report) => (
            <ReportCard key={report.id} report={report} />
          ))}
        </div>
      )}
    </div>
  );
}
