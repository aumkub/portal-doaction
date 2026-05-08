import { NavLink, Form } from "react-router";
import { useState } from "react";
import { Sheet, SheetContent, SheetTrigger } from "~/components/ui/sheet";
import { ScrollArea } from "~/components/ui/scroll-area";
import { cn } from "~/lib/utils";
import { useT } from "~/lib/i18n";
import type { TranslationKey } from "~/lib/translations";
import type { IconType } from "react-icons";
import {
  FaArrowRightFromBracket,
  FaChartColumn,
  FaEnvelope,
  FaFileLines,
  FaGear,
  FaHeadset,
  FaHouse,
  FaPaperclip,
  FaTicket,
  FaUserSecret,
  FaUsers,
} from "react-icons/fa6";

type NavItem = { labelKey: TranslationKey; href: string; icon: IconType; end?: boolean; roles?: ("admin" | "co-admin")[] };

const clientNav: NavItem[] = [
  { labelKey: "nav_dashboard", href: "/dashboard", icon: FaChartColumn, end: true },
  { labelKey: "nav_reports", href: "/reports", icon: FaFileLines },
  { labelKey: "nav_tickets", href: "/tickets", icon: FaTicket },
  { labelKey: "nav_documents", href: "/documents", icon: FaFileLines },
  { labelKey: "nav_settings", href: "/settings", icon: FaGear },
];

const adminNav: NavItem[] = [
  { labelKey: "nav_overview", href: "/admin", icon: FaHouse, end: true },
  { labelKey: "nav_clients", href: "/admin/clients", icon: FaUsers },
  { labelKey: "nav_co_admins", href: "/admin/co-admins", icon: FaUserSecret },
  { labelKey: "nav_admin_reports", href: "/admin/reports", icon: FaFileLines },
  { labelKey: "nav_all_tickets", href: "/admin/tickets", icon: FaTicket },
  { labelKey: "nav_attachments", href: "/admin/attachments", icon: FaPaperclip },
  { labelKey: "nav_email_logs", href: "/admin/email-logs", icon: FaEnvelope },
  { labelKey: "nav_settings", href: "/admin/settings", icon: FaGear },
];

const coAdminNav: NavItem[] = [
  { labelKey: "nav_overview", href: "/admin", icon: FaHouse, end: true },
  { labelKey: "nav_clients", href: "/admin/clients", icon: FaUsers },
  { labelKey: "nav_admin_reports", href: "/admin/reports", icon: FaFileLines },
  { labelKey: "nav_all_tickets", href: "/admin/tickets", icon: FaTicket },
];

interface SidebarProps {
  role: "client" | "admin" | "co-admin";
  companyName?: string | null;
}

function NavItems({ nav, onNavigate }: { nav: NavItem[]; onNavigate?: () => void }) {
  const { t } = useT();
  return (
    <nav className="flex-1 py-4 px-3 space-y-0.5">
      {nav.map((item) => (
        <NavLink
          key={item.href}
          to={item.href}
          end={item.end}
          prefetch="intent"
          onClick={onNavigate}
          className={({ isActive }) =>
            cn(
              "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors",
              isActive
                ? "bg-brand-yellow text-primary"
                : "text-slate-400 hover:text-white hover:bg-white/5"
            )
          }
        >
          <item.icon className="text-base leading-none" aria-hidden="true" />
          {t(item.labelKey)}
        </NavLink>
      ))}
    </nav>
  );
}

function NavItemsWithRole({ nav, userRole, onNavigate }: { nav: NavItem[]; userRole?: string; onNavigate?: () => void }) {
  const { t } = useT();
  return (
    <nav className="flex-1 py-4 px-3 space-y-0.5">
      {nav
        .filter((item) => !item.roles || item.roles.includes(userRole as any))
        .map((item) => (
          <NavLink
            key={item.href}
            to={item.href}
            end={item.end}
            prefetch="intent"
            onClick={onNavigate}
            className={({ isActive }) =>
              cn(
                "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors",
                isActive
                  ? "bg-brand-yellow text-primary"
                  : "text-slate-400 hover:text-white hover:bg-white/5"
              )
            }
          >
            <item.icon className="text-base leading-none" aria-hidden="true" />
            {t(item.labelKey)}
          </NavLink>
        ))}
    </nav>
  );
}

function LogoBlock({ companyName }: { companyName?: string | null }) {
  return (
    <div className="py-3 pb-2 pt-1 flex flex-col justify-center px-5 border-b !border-white/10 shrink-0">

      <div>
        <div className="flex items-center gap-3">
          <img
            src="/logo-white.svg"
            alt="do action"
            className="object-cover w-[150px] mx-auto block"
          />
          {/* <span className="font-bold text-2xl text-slate-900 tracking-tight">do action</span> */}
        </div>
        <p className="block text-center text-[10px] text-white mt-0 tracking-widest font-bold">CLIENT PORTAL</p>
      </div>
      {companyName && (
        <p className="text-white text-xs mt-1.5 truncate text-center">{companyName}</p>
      )}
    </div>
  );
}

/** Above logout — full contact page with LINE / phone / social / email. */
function ClientContactNavLink({ onNavigate }: { onNavigate?: () => void }) {
  const { t } = useT();
  return (
    <div className="px-3 pt-2 pb-1 border-t !border-white/10 shrink-0">
      <NavLink
        to="/contact"
        onClick={onNavigate}
        className={({ isActive }) =>
          cn(
            "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors",
            isActive
              ? "bg-brand-yellow text-primary"
              : "text-slate-400 hover:text-white hover:bg-white/5"
          )
        }
      >
        <FaHeadset className="text-base leading-none" aria-hidden="true" />
        {t("nav_contact_team")}
      </NavLink>
    </div>
  );
}

function LogoutButton() {
  const { t } = useT();
  return (
    <div className="p-3 border-t !border-white/10 shrink-0">
      <Form method="post" action="/logout">
        <button
          type="submit"
          className="flex items-center gap-3 w-full px-3 py-2.5 rounded-lg text-sm text-slate-400 hover:text-white hover:bg-white/5 transition-colors"
        >
          <FaArrowRightFromBracket className="text-base leading-none" aria-hidden="true" />
          {t("nav_logout")}
        </button>
      </Form>
    </div>
  );
}

function SidebarContent({
  role,
  companyName,
  onNavigate,
}: SidebarProps & { onNavigate?: () => void }) {
  const { t } = useT();
  const nav = role === "co-admin" ? coAdminNav : role === "admin" ? adminNav : clientNav;
  return (
    <div className="flex h-full flex-col bg-sidebar">
      <LogoBlock companyName={companyName} />
      {role === "admin" || role === "co-admin" ? (
        <div className="px-5 pt-3">
          <span className={`inline-flex rounded-full px-2.5 py-1 text-[11px] font-semibold ${
            role === "co-admin" ? "bg-success-accent/20 text-success-accent" : "bg-brand-yellow/20 text-brand-yellow"
          }`}>
            {role === "co-admin" ? "CO-ADMIN" : t("nav_badge_admin")}
          </span>
        </div>
      ) : null}
      <ScrollArea className="flex-1">
        <NavItems nav={nav} onNavigate={onNavigate} />
      </ScrollArea>
      {role === "client" ? <ClientContactNavLink onNavigate={onNavigate} /> : null}
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
  const [open, setOpen] = useState(false);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
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
        <SidebarContent
          role={role}
          companyName={companyName}
          onNavigate={() => setOpen(false)}
        />
      </SheetContent>
    </Sheet>
  );
}

/** Default export combines both into a fragment — use inside a flex layout. */
export default function Sidebar(props: SidebarProps) {
  return <DesktopSidebar {...props} />;
}
