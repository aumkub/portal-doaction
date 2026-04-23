import { Form, useRevalidator } from "react-router";
import { useEffect } from "react";
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
import { FaBell, FaFileLines, FaGear, FaArrowRightFromBracket } from "react-icons/fa6";

interface TopbarProps {
  user: User;
  companyName?: string | null;
  notifications?: Notification[];
  role?: "client" | "admin";
}

// ─── 30-second polling ───────────────────────────────────────────────────────
function usePolling(intervalMs: number) {
  const revalidator = useRevalidator();
  useEffect(() => {
    const id = setInterval(() => {
      if (revalidator.state === "idle") revalidator.revalidate();
    }, intervalMs);
    return () => clearInterval(id);
  }, [revalidator, intervalMs]);
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
          className="relative p-2 rounded-lg text-slate-500 hover:bg-slate-100 transition-colors focus:outline-none"
          aria-label={t("topbar_notifications")}
        >
          <svg
            className="w-5 h-5"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.8}
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"
            />
          </svg>
          {unread.length > 0 && (
            <span className={`absolute top-1 right-1 w-4 h-4 bg-violet-600 text-white font-bold rounded-full flex items-center justify-center leading-none
              ${unread.length > 9 ? "text-[8px]" : "text-[10px]"}`}>
              {unread.length > 9 ? "9+" : unread.length}
            </span>
          )}
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-80">
        <div className="flex items-center justify-between px-3 py-2 border-b border-slate-100">
          <span className="text-sm font-semibold text-slate-900">
            {t("topbar_notifications")}
          </span>
          {unread.length > 0 && (
            <Form method="post" action="/api/notifications/read">
              <button
                type="submit"
                className="text-xs text-violet-600 hover:text-violet-700 transition-colors"
              >
                {t("topbar_mark_all_read")}
              </button>
            </Form>
          )}
        </div>

        {notifications.length === 0 ? (
          <div className="px-3 py-8 text-center">
            <FaBell className="mx-auto mb-1 text-2xl text-slate-400" aria-hidden="true" />
            <p className="text-sm text-slate-400">{t("topbar_no_notifications")}</p>
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
                  className={`w-full text-left px-3 py-3 hover:bg-slate-50 transition-colors border-b border-slate-50 last:border-0 ${
                    !n.read ? "bg-violet-50/50" : ""
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
                      <p className="text-sm font-medium text-slate-800 leading-tight">
                        {n.title}
                      </p>
                      {n.body && (
                        <p className="text-xs text-slate-500 mt-0.5 leading-relaxed truncate">
                          {n.body}
                        </p>
                      )}
                      <p className="text-[11px] text-slate-400 mt-1">
                        {formatRelativeTime(n.created_at, lang)}
                      </p>
                    </div>
                    {!n.read && (
                      <span className="w-2 h-2 bg-violet-500 rounded-full mt-1.5 shrink-0" />
                    )}
                  </div>
                </button>
              </Form>
            ))}
          </div>
        )}
        <div className="border-t border-slate-100 px-3 py-2">
          <a href={allHref} className="text-xs text-violet-600 hover:text-violet-700">
            {t("view_all")}
          </a>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// ─── Topbar ───────────────────────────────────────────────────────────────────
export default function Topbar({
  user,
  companyName,
  notifications = [],
  role = "client",
}: TopbarProps) {
  const { t } = useT();

  // Poll every 30 s so notification count stays fresh
  usePolling(30_000);

  const initials = user.name
    .split(" ")
    .map((n) => n[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  const settingsHref = role === "admin" ? "/admin/settings" : "/settings";

  return (
    <header className="h-16 bg-white border-b border-slate-200 flex items-center justify-between px-4 lg:px-6 shrink-0">
      {/* Left */}
      <div className="flex items-center gap-3">
        <MobileSidebarTrigger role={role} companyName={companyName} />
        {companyName && (
          <span className="text-sm text-slate-500 hidden sm:block">
            {companyName}
          </span>
        )}
      </div>

      {/* Right */}
      <div className="flex items-center gap-1">
        <LanguageSwitcher />
        <NotificationDropdown notifications={notifications} role={role} />

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="flex items-center gap-2 ml-1 rounded-lg px-2 py-1.5 hover:bg-slate-100 transition-colors focus:outline-none">
              <Avatar className="h-7 w-7">
                {user.avatar_url && (
                  <AvatarImage src={user.avatar_url} alt={user.name} />
                )}
                <AvatarFallback className="bg-slate-900 text-white text-xs font-semibold">
                  {initials}
                </AvatarFallback>
              </Avatar>
              <span className="text-sm text-slate-700 hidden sm:block">
                {user.name}
              </span>
              <svg
                className="w-4 h-4 text-slate-400 hidden sm:block"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
            </button>
          </DropdownMenuTrigger>

          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuLabel className="font-normal">
              <p className="font-medium text-slate-900 text-sm">{user.name}</p>
              <p className="text-xs text-slate-500 truncate">{user.email}</p>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <a href={settingsHref}>
                <span className=""><FaGear aria-hidden="true" /></span> {t("topbar_account_settings")}
              </a>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <Form method="post" action="/logout">
              <button
                type="submit"
                className="w-full flex items-center gap-2 px-2 py-1.5 text-sm text-red-500 hover:bg-slate-100 rounded-md transition-colors text-left"
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
