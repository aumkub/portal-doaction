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
import { MobileSidebarTrigger } from "~/components/layout/Sidebar";
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
          className="relative h-9 w-9 rounded-full border border-hairline bg-canvas text-steel transition-colors focus:outline-none focus:ring-2 focus:ring-brand-blue/30"
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

      <DropdownMenuContent align="end" className="w-80">
        <div className="flex items-center justify-between px-3 py-2 border-b border-hairline-soft">
          <span className="text-sm font-semibold text-ink">
            {t("topbar_notifications")}
          </span>
          {unread.length > 0 && (
            <Form method="post" action="/api/notifications/read">
              <button
                type="submit"
                className="text-xs text-brand-blue hover:text-blue-pressed transition-colors"
              >
                {t("topbar_mark_all_read")}
              </button>
            </Form>
          )}
        </div>

        {notifications.length === 0 ? (
          <div className="px-3 py-8 text-center">
            <FaBell className="mx-auto mb-1 text-2xl text-stone" aria-hidden="true" />
            <p className="text-sm text-stone">{t("topbar_no_notifications")}</p>
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
                  className={`w-full text-left px-3 py-3 transition-colors border-b border-hairline-soft last:border-0 ${
                    !n.read ? "bg-surface" : ""
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
                      <p className="text-sm font-medium text-ink leading-tight">
                        {n.title}
                      </p>
                      {n.body && (
                        <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed truncate">
                          {n.body}
                        </p>
                      )}
                      <p className="text-[11px] text-stone mt-1">
                        {formatRelativeTime(n.created_at, lang)}
                      </p>
                    </div>
                    {!n.read && (
                      <span className="w-2 h-2 bg-brand-yellow rounded-full mt-1.5 shrink-0" />
                    )}
                  </div>
                </button>
              </Form>
            ))}
          </div>
        )}
        <div className="border-t border-hairline-soft px-3 py-2">
          <a href={allHref} className="text-xs text-brand-blue hover:text-blue-pressed">
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
    <Avatar className="h-7 w-7 bg-slate-900 text-white">
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
    <header className="h-16 bg-canvas border-b border-hairline flex items-center justify-between px-4 lg:px-6 shrink-0">
      {/* Left */}
      <div className="flex items-center gap-3">
        <MobileSidebarTrigger role={role} companyName={companyName} />
        {companyName && (
          <span className="text-sm text-muted-foreground hidden sm:block">
            {companyName}
          </span>
        )}
      </div>

      {/* Right */}
      <div className="flex items-center gap-2">
        <LanguageSwitcher />
        <NotificationDropdown notifications={notifications} role={role} />

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="ml-1 flex h-10 items-center gap-2 rounded-full border border-hairline bg-canvas px-2.5 transition-colors focus:outline-none focus:ring-2 focus:ring-brand-blue/30">
              <UserAvatar name={user.name} src={user.avatar_url} initials={initials} />
              <span className="text-sm text-charcoal hidden sm:block">
                {user.name}
              </span>
              <FaChevronDown className="hidden h-3.5 w-3.5 text-stone sm:block" aria-hidden="true" />
            </button>
          </DropdownMenuTrigger>

          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuLabel className="font-normal">
              <p className="font-medium text-ink text-sm">{user.name}</p>
              <p className="text-xs text-muted-foreground truncate">{user.email}</p>
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
                className="w-full flex items-center gap-2 px-2 py-1.5 text-sm text-red-500 hover:bg-surface rounded-md transition-colors text-left"
              >
                <span><FaArrowRightFromBracket aria-hidden="true" /></span> {t("topbar_logout")}
              </button>
            </Form>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
