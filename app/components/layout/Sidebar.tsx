import { NavLink, Form } from "react-router";
import { Sheet, SheetContent, SheetTrigger } from "~/components/ui/sheet";
import { ScrollArea } from "~/components/ui/scroll-area";
import { cn } from "~/lib/utils";
import { useT } from "~/lib/i18n";
import type { TranslationKey } from "~/lib/translations";

type NavItem = { labelKey: TranslationKey; href: string; icon: string; end?: boolean };

const clientNav: NavItem[] = [
  { labelKey: "nav_dashboard", href: "/dashboard", icon: "📊", end: true },
  { labelKey: "nav_reports", href: "/reports", icon: "📋" },
  { labelKey: "nav_tickets", href: "/tickets", icon: "🎫" },
  { labelKey: "nav_documents", href: "/documents", icon: "📄" },
  { labelKey: "nav_settings", href: "/settings", icon: "⚙️" },
];

const adminNav: NavItem[] = [
  { labelKey: "nav_overview", href: "/admin", icon: "🏠", end: true },
  { labelKey: "nav_clients", href: "/admin/clients", icon: "👥" },
  { labelKey: "nav_admin_reports", href: "/admin/reports", icon: "📋" },
  { labelKey: "nav_all_tickets", href: "/admin/tickets", icon: "🎫" },
  { labelKey: "nav_settings", href: "/admin/settings", icon: "⚙️" },
];

interface SidebarProps {
  role: "client" | "admin";
  companyName?: string | null;
}

function NavItems({ nav }: { nav: NavItem[] }) {
  const { t } = useT();
  return (
    <nav className="flex-1 py-4 px-3 space-y-0.5">
      {nav.map((item) => (
        <NavLink
          key={item.href}
          to={item.href}
          end={item.end}
          prefetch="intent"
          className={({ isActive }) =>
            cn(
              "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors",
              isActive
                ? "bg-[#EED900] text-black"
                : "text-slate-400 hover:text-white hover:bg-white/5"
            )
          }
        >
          <span className="text-base leading-none">{item.icon}</span>
          {t(item.labelKey)}
        </NavLink>
      ))}
    </nav>
  );
}

function LogoBlock({ companyName }: { companyName?: string | null }) {
  return (
    <div className="py-4 flex flex-col justify-center px-5 border-b !border-gray-700 shrink-0">
      <div className="flex items-center gap-2">
        <div className="w-7 h-7 bg-[#F0D800] rounded-lg flex items-center justify-center shadow-sm shrink-0">
          <span className="text-slate-900 font-bold text-xs leading-none">D</span>
        </div>
        <div className="min-w-0">
          <p className="text-white font-semibold text-sm leading-tight">DoAction</p>
          <p className="text-slate-500 text-xs leading-tight">Client Portal</p>
        </div>
      </div>
      {companyName && (
        <p className="text-slate-400 text-xs mt-1.5 ml-9 truncate">{companyName}</p>
      )}
    </div>
  );
}

function LogoutButton() {
  const { t } = useT();
  return (
    <div className="p-3 border-t !border-gray-700 shrink-0">
      <Form method="post" action="/logout">
        <button
          type="submit"
          className="flex items-center gap-3 w-full px-3 py-2.5 rounded-lg text-sm text-slate-400 hover:text-white hover:bg-white/5 transition-colors"
        >
          <span className="text-base leading-none">🚪</span>
          {t("nav_logout")}
        </button>
      </Form>
    </div>
  );
}

function SidebarContent({ role, companyName }: SidebarProps) {
  const nav = role === "admin" ? adminNav : clientNav;
  return (
    <div className={`flex h-full flex-col ${role === "admin" ? "bg-black/90" : "bg-black/90"}`}>
      <LogoBlock companyName={companyName} />
      {role === "admin" ? (
        <div className="px-5 pt-3">
          <span className="inline-flex rounded-full bg-violet-600/20 px-2.5 py-1 text-[11px] font-semibold text-violet-300">
            Admin
          </span>
        </div>
      ) : null}
      <ScrollArea className="flex-1">
        <NavItems nav={nav} />
      </ScrollArea>
      <LogoutButton />
    </div>
  );
}

/** Desktop sidebar (always visible, 240 px wide). */
export function DesktopSidebar({ role, companyName }: SidebarProps) {
  return (
    <aside className="w-60 shrink-0 hidden lg:flex flex-col h-full">
      <SidebarContent role={role} companyName={companyName} />
    </aside>
  );
}

/** Mobile sidebar trigger + Sheet. */
export function MobileSidebarTrigger({ role, companyName }: SidebarProps) {
  return (
    <Sheet>
      <SheetTrigger asChild>
        <button
          className="lg:hidden p-2 rounded-lg text-slate-600 hover:bg-slate-100 transition-colors"
          aria-label="Open menu"
        >
          <svg
            className="w-5 h-5"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M4 6h16M4 12h16M4 18h16"
            />
          </svg>
        </button>
      </SheetTrigger>
      <SheetContent side="left" className="w-60 p-0 border-0">
        <SidebarContent role={role} companyName={companyName} />
      </SheetContent>
    </Sheet>
  );
}

/** Default export combines both into a fragment — use inside a flex layout. */
export default function Sidebar(props: SidebarProps) {
  return <DesktopSidebar {...props} />;
}
