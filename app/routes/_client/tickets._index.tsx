import { Link, useSearchParams } from "react-router";
import { requireUser } from "~/lib/auth.server";
import { createDB } from "~/lib/db.server";
import type { SupportTicket, TicketStatus } from "~/types";
import TicketCard from "~/components/tickets/TicketCard";

export function meta() {
  return [{ title: "แจ้งปัญหา — DoAction Portal" }];
}

export async function loader({ request, context }: any) {
  const user = await requireUser(
    request,
    context.cloudflare.env.DB,
    context.cloudflare.env.SESSIONPORTAL
  );
  const db = createDB(context.cloudflare.env.DB);
  const client = await db.getClientByUserId(user.id);
  if (!client) return { tickets: [] };
  const tickets = await db.listTicketsByClient(client.id);
  return { tickets };
}

export default function TicketsIndexPage({ loaderData }: any) {
  const { tickets } = loaderData as { tickets: SupportTicket[] };
  const [searchParams, setSearchParams] = useSearchParams();
  const status = searchParams.get("status") ?? "all";

  const filtered =
    status === "all"
      ? tickets
      : tickets.filter((ticket) => ticket.status === (status as TicketStatus));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">แจ้งปัญหา</h1>
          <p className="mt-1 text-sm text-slate-500">
            ติดตามและจัดการคำร้องทั้งหมดของคุณ
          </p>
        </div>
        <Link
          to="/tickets/new"
          className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-violet-700"
        >
          + แจ้งปัญหาใหม่
        </Link>
      </div>

      <div className="flex flex-wrap gap-2">
        {[
          ["all", "ทั้งหมด"],
          ["open", "เปิด"],
          ["in_progress", "กำลังดำเนิน"],
          ["resolved", "เสร็จสิ้น"],
        ].map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() =>
              setSearchParams(value === "all" ? {} : { status: value })
            }
            className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
              status === value
                ? "bg-slate-900 text-white"
                : "border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="grid gap-3">
        {filtered.length ? (
          filtered.map((ticket) => <TicketCard key={ticket.id} ticket={ticket} />)
        ) : (
          <div className="rounded-xl border border-slate-200 bg-white p-10 text-center text-sm text-slate-400">
            ไม่พบรายการแจ้งปัญหา
          </div>
        )}
      </div>
    </div>
  );
}
