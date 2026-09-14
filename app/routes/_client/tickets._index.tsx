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
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-ink">{t("tickets_title")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t("tickets_subtitle")}</p>
        </div>
        <Link
          to="/tickets/new"
          className="rounded-full bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/85"
        >
          {t("tickets_new_btn")}
        </Link>
      </div>

      <div className="flex flex-wrap gap-2">
        {filters.map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => setSearchParams(value === "all" ? {} : { status: value })}
            className={`rounded-full px-4 py-1.5 text-xs font-medium transition-colors ${
              status === value
                ? "bg-primary text-primary-foreground"
                : "border border-hairline bg-canvas text-charcoal hover:bg-surface"
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
          <div className="rounded-xl border border-hairline bg-canvas p-10 text-center text-sm text-stone">
            {t("tickets_empty")}
          </div>
        )}
      </div>
    </div>
  );
}
