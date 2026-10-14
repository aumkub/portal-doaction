import { Form, useFetcher } from "react-router";
import { useEffect, useState } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "~/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { ClientTopNav, MobileSidebarTrigger, type NavBadges } from "~/components/layout/Sidebar";
import { formatRelativeTime } from "~/lib/utils";
import { useT, LanguageSwitcher } from "~/lib/i18n";
import type { User, Notification } from "~/types";
import {
  FaBell,
  FaFileLines,
  FaGear,
  FaArrowRightFromBracket,
  FaChevronDown,
} from "react-icons/fa6";

interface TopbarProps {
  user: User;
  companyName?: string | null;
  notifications?: Notification[];
  role?: "client" | "admin" | "co-admin";
  navBadges?: NavBadges;
}

/**
 * Polls only the notifications endpoint. Using a fetcher rather than
 * revalidate() keeps the poll from re-running every loader on the page.
 */
function usePolledNotifications(
  initial: Notification[],
  intervalMs: number
): Notification[] {
  const fetcher = useFetcher<{ notifications: Notification[] }>();

  useEffect(() => {
    const id = setInterval(() => {
      if (fetcher.state === "idle") fetcher.load("/api/notifications");
    }, intervalMs);
    return () => clearInterval(id);
  }, [fetcher, intervalMs]);

  return fetcher.data?.notifications ?? initial;
}

function isUsableAvatarUrl(url: string | null | undefined): url is string {
  if (!url) return false;
  return /^(https?:\/\/|\/)/.test(url.trim());
}

// ─── Bell + Notification Dropdown ────────────────────────────────────────────
function NotificationDropdown({
  notifications,
  role,
}: {
  notifications: Notification[];
  role: "client" | "admin";
}) {
  const { t, lang } = useT();
  const unread = notifications.filter((n) => !n.read);
  const allHref = role === "admin" ? "/admin/notifications" : "/notifications";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className="relative h-10 w-10 rounded-full border border-line bg-white hover:bg-paper text-steel transition-colors focus:outline-none focus:ring-2 focus:ring-brand-blue/30"
          aria-label={t("topbar_notifications")}
        >
          <FaBell className="mx-auto h-4 w-4" aria-hidden="true" />
          {unread.length > 0 && (
            <span className={`absolute top-1 right-1 w-4 h-4 bg-brand-yellow text-black font-bold rounded-full flex items-center justify-center leading-none
              ${unread.length > 9 ? "text-[8px]" : "text-[10px]"}`}>
              {unread.length > 9 ? "9+" : unread.length}
            </span>
          )}
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-[min(22rem,calc(100vw-2rem))] p-0 overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-line-soft">
          <span className="text-[15px] font-semibold text-ink">
            {t("topbar_notifications")}
          </span>
          {unread.length > 0 && (
            <Form method="post" action="/api/notifications/read">
              <button
                type="submit"
                className="text-xs font-medium text-muted-ink hover:text-ink transition-colors"
              >
                {t("topbar_mark_all_read")}
              </button>
            </Form>
          )}
        </div>

        {notifications.length === 0 ? (
          <div className="px-4 py-10 text-center">
            <FaBell className="mx-auto mb-2 text-base text-faint-ink" aria-hidden="true" />
            <p className="text-sm text-muted-ink">{t("topbar_no_notifications")}</p>
          </div>
        ) : (
          <div className="max-h-80 overflow-y-auto">
            {notifications.slice(0, 10).map((n) => (
              <Form
                key={n.id}
                method="post"
                action="/api/notifications/read"
              >
                <input type="hidden" name="id" value={n.id} />
                <button
                  type="submit"
                  className={`w-full text-left px-5 py-3.5 transition-colors hover:bg-paper border-b border-line-soft last:border-0 ${
                    !n.read ? "bg-paper/60" : ""
                  }`}
                >
                  <div className="flex items-start gap-2">
                    <span className="text-base leading-none mt-0.5 shrink-0">
                      {n.type === "report_published" ? (
                        <FaFileLines aria-hidden="true" />
                      ) : (
                        <FaBell aria-hidden="true" />
                      )}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] font-medium text-ink leading-tight">
                        {n.title}
                      </p>
                      {n.body && (
                        <p className="text-xs text-muted-ink mt-0.5 leading-relaxed truncate">
                          {n.body}
                        </p>
                      )}
                      <p className="text-[11px] text-faint-ink mt-1 tabular-nums">
                        {formatRelativeTime(n.created_at, lang)}
                      </p>
                    </div>
                    {!n.read && (
                      <span className="w-1.5 h-1.5 bg-brand-yellow rounded-full mt-1.5 shrink-0" />
                    )}
                  </div>
                </button>
              </Form>
            ))}
          </div>
        )}
        <div className="border-t border-line-soft px-5 py-3">
          <a href={allHref} className="text-[13px] font-semibold text-ink hover:underline underline-offset-4">
            {t("view_all")}
          </a>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function UserAvatar({
  name,
  src,
  initials,
}: {
  name: string;
  src: string | null;
  initials: string;
}) {
  const [failed, setFailed] = useState(false);
  const showImage = !failed && isUsableAvatarUrl(src);

  useEffect(() => {
    setFailed(false);
  }, [src]);

  return (
    <Avatar className="h-8 w-8 bg-ink text-white">
      {showImage ? (
        <AvatarImage
          src={src}
          alt={name}
          onError={() => setFailed(true)}
        />
      ) : null}
      <AvatarFallback className="bg-slate-900 text-white text-xs font-semibold">
        {initials || "?"}
      </AvatarFallback>
    </Avatar>
  );
}

// ─── Topbar ───────────────────────────────────────────────────────────────────
export default function Topbar({
  user,
  companyName,
  notifications: initialNotifications = [],
  role = "client",
  navBadges,
}: TopbarProps) {
  const { t } = useT();

  const notifications = usePolledNotifications(initialNotifications, 30_000);

  const initials = user.name
    .split(" ")
    .map((n) => n[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  const settingsHref =
    role === "admin" ? "/admin/settings" : role === "client" ? "/settings" : null;

  return (
    <header className="h-16 bg-white border-b border-line shrink-0 sticky top-0 z-20">
      <div className={`h-full flex items-center justify-between gap-6 px-4 lg:px-8 ${role === "client" ? "mx-auto max-w-[1248px]" : ""}`}>
      {/* Left */}
      <div className="flex items-center gap-6 min-w-0">
        {role === "client" ? (
          <>
            <a href="/dashboard" className="shrink-0">
              <img src="/logo-dark-tight.svg" alt="do action" className="h-12 w-auto" />
            </a>
            <ClientTopNav navBadges={navBadges} />
          </>
        ) : (
          <MobileSidebarTrigger role={role} companyName={companyName} navBadges={navBadges} />
        )}
      </div>

      {/* Right */}
      <div className="flex items-center gap-2">
        <LanguageSwitcher />
        <NotificationDropdown notifications={notifications} role={role} />

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="ml-1 flex h-10 items-center gap-2 rounded-full border border-transparent hover:border-line hover:bg-paper pl-1 pr-2 transition-colors focus:outline-none focus:ring-2 focus:ring-brand-blue/30">
              <UserAvatar name={user.name} src={user.avatar_url} initials={initials} />
              <span className="text-sm text-charcoal hidden sm:block">
                {user.name}
              </span>
              <FaChevronDown className="hidden h-3.5 w-3.5 text-stone sm:block" aria-hidden="true" />
            </button>
          </DropdownMenuTrigger>

          <DropdownMenuContent align="end" className="w-60">
            <DropdownMenuLabel className="font-normal">
              <p className="font-medium text-ink text-sm">{user.name}</p>
              <p className="text-xs text-muted-ink truncate">{user.email}</p>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            {settingsHref && (
              <>
                <DropdownMenuItem asChild>
                  <a href={settingsHref}>
                    <span className=""><FaGear aria-hidden="true" /></span> {t("topbar_account_settings")}
                  </a>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
              </>
            )}
            <Form method="post" action="/logout">
              <button
                type="submit"
                className="w-full flex items-center gap-2 px-2.5 py-2 text-[13px] text-[#B4541A] hover:bg-[#FDE7DA] rounded-lg transition-colors text-left"
              >
                <span><FaArrowRightFromBracket aria-hidden="true" /></span> {t("topbar_logout")}
              </button>
            </Form>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      </div>
    </header>
  );
}
