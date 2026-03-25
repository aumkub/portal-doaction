import { Form } from "react-router";
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
import type { User } from "~/types";

interface TopbarProps {
  user: User;
  companyName?: string | null;
  notifCount?: number;
  role?: "client" | "admin";
}

function BellIcon({ count }: { count: number }) {
  return (
    <button className="relative p-2 rounded-lg text-slate-500 hover:bg-slate-100 transition-colors">
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
      {count > 0 && (
        <span className="absolute top-1 right-1 w-4 h-4 bg-violet-600 text-white text-[10px] font-bold rounded-full flex items-center justify-center leading-none">
          {count > 9 ? "9+" : count}
        </span>
      )}
    </button>
  );
}

export default function Topbar({
  user,
  companyName,
  notifCount = 0,
  role = "client",
}: TopbarProps) {
  const initials = user.name
    .split(" ")
    .map((n) => n[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <header className="h-16 bg-white border-b border-slate-200 flex items-center justify-between px-4 lg:px-6 shrink-0">
      {/* Left: mobile menu + company name */}
      <div className="flex items-center gap-3">
        <MobileSidebarTrigger role={role} companyName={companyName} />
        {companyName && (
          <span className="text-sm text-slate-500 hidden sm:block">
            {companyName}
          </span>
        )}
      </div>

      {/* Right: notifications + user menu */}
      <div className="flex items-center gap-1">
        <BellIcon count={notifCount} />

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
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M19 9l-7 7-7-7"
                />
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
              <a href="/settings">
                <span className="mr-2">⚙️</span> ตั้งค่าบัญชี
              </a>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Form method="post" action="/logout" className="w-full">
                <button
                  type="submit"
                  className="flex items-center gap-2 w-full text-red-500 text-sm"
                >
                  <span>🚪</span> ออกจากระบบ
                </button>
              </Form>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
