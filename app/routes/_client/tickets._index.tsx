import { Link, Form, redirect, useSearchParams } from "react-router";
import { requireUser } from "~/lib/auth.server";
import { createDB } from "~/lib/db.server";
import { useT } from "~/lib/i18n";
import type { SupportTicket, TicketStatus } from "~/types";
import TicketCard from "~/components/tickets/TicketCard";

export function meta() {
  return [{ title: "Support Tickets — do action portal" }];
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

export async function action({ request, context }: any) {
  const user = await requireUser(
    request,
    context.cloudflare.env.DB,
    context.cloudflare.env.SESSIONPORTAL
  );
  const db = createDB(context.cloudflare.env.DB);
  const formData = await request.formData();
  const intent = formData.get("intent");
  const ticketId = formData.get("ticketId") as string;

  if (intent === "delete" && ticketId) {
    const ticket = await db.getTicket(ticketId);
    if (!ticket) return null;

    // Verify the ticket belongs to this user's client and is open
    const client = await db.getClientByUserId(user.id);
    if (!client || ticket.client_id !== client.id) return null;
    if (ticket.status !== "open") return null;

    await db.softDeleteTicket(ticketId, user.id);
  }

  return redirect("/tickets");
}

export default function TicketsIndexPage({ loaderData }: any) {
  const { tickets } = loaderData as { tickets: SupportTicket[] };
  const [searchParams, setSearchParams] = useSearchParams();
  const status = searchParams.get("status") ?? "all";
  const { t } = useT();

  const filtered =
    status === "all"
      ? tickets
      : tickets.filter((ticket) => ticket.status === (status as TicketStatus));

  const filters: [string, string][] = [
    ["all", t("tickets_filter_all")],
    ["open", t("tickets_filter_open")],
    ["in_progress", t("tickets_filter_in_progress")],
    ["waiting", t("status_waiting")],
    ["resolved", t("tickets_filter_resolved")],
    ["closed", t("status_closed_short")],
  ];

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[28px] md:text-[32px] font-bold leading-tight tracking-[-0.02em] text-ink">{t("tickets_title")}</h1>
          <p className="mt-1 text-sm text-muted-ink">{t("tickets_subtitle")}</p>
        </div>
        <Link
          to="/tickets/new"
          className="inline-flex h-10 items-center rounded-full bg-ink px-5 text-[13px] font-semibold text-white hover:bg-black transition-colors"
        >
          {t("tickets_new_btn")}
        </Link>
      </div>

      <div className="inline-flex flex-wrap rounded-lg bg-paper p-0.5">
        {filters.map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => setSearchParams(value === "all" ? {} : { status: value })}
            className={`h-8 shrink-0 whitespace-nowrap rounded-full px-3.5 text-[13px] font-medium transition-colors ${
              status === value
                ? "bg-white text-ink"
                : "text-muted-ink hover:text-ink"
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
          <div className="rounded-[20px] border border-line bg-white p-10 text-center text-sm text-muted-ink">
            {t("tickets_empty")}
          </div>
        )}
      </div>
    </div>
  );
}
