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
  FaMagnifyingGlass,
  FaChartColumn,
  FaEnvelope,
  FaFileLines,
  FaGear,
  FaHeadset,
  FaHouse,
  FaPaperclip,
  FaPlus,
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
  { labelKey: "nav_email_logs", href: "/admin/email-logs", icon: FaEnvelope },
  { labelKey: "nav_attachments", href: "/admin/attachments", icon: FaPaperclip },
  { labelKey: "nav_settings", href: "/admin/settings", icon: FaGear },
];

const coAdminNav: NavItem[] = [
  { labelKey: "nav_overview", href: "/admin", icon: FaHouse, end: true },
  { labelKey: "nav_clients", href: "/admin/clients", icon: FaUsers },
  { labelKey: "nav_admin_reports", href: "/admin/reports", icon: FaFileLines },
  { labelKey: "nav_all_tickets", href: "/admin/tickets", icon: FaTicket },
];

/** Counts shown beside nav items, keyed by href. */
export type NavBadges = Record<string, number>;

interface SidebarProps {
  role: "client" | "admin" | "co-admin";
  companyName?: string | null;
  navBadges?: NavBadges;
}

/** Shared look for every sidebar link: quiet by default, a brand bar when active. */
function navItemClass(isActive: boolean) {
  return cn(
    "flex items-center gap-2.5 h-10 px-3 rounded-[10px] text-sm font-medium transition-colors",
    isActive
      ? "bg-[#26261F] text-brand-yellow"
      : "text-[#C9C7C0] hover:text-white hover:bg-white/5"
  );
}

function NavBadge({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span
      className="ml-auto inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-brand-yellow px-1.5 text-[11px] font-bold leading-none text-ink tabular-nums"
      aria-label={`${count} ticket ที่ยังไม่ได้แก้`}
    >
      {count > 99 ? "99+" : count}
    </span>
  );
}

function NavItems({
  nav,
  onNavigate,
  navBadges,
}: {
  nav: NavItem[];
  onNavigate?: () => void;
  navBadges?: NavBadges;
}) {
  const { t } = useT();
  return (
    <nav className="flex-1 space-y-1">
      {nav.map((item) => (
        <NavLink
          key={item.href}
          to={item.href}
          end={item.end}
          prefetch="intent"
          onClick={onNavigate}
          className={({ isActive }) =>
            cn(
navItemClass(isActive)
            )
          }
        >
          <item.icon className="text-[15px] leading-none shrink-0 opacity-80" aria-hidden="true" />
          {t(item.labelKey)}
          <NavBadge count={navBadges?.[item.href] ?? 0} />
        </NavLink>
      ))}
    </nav>
  );
}

function NavItemsWithRole({ nav, userRole, onNavigate }: { nav: NavItem[]; userRole?: string; onNavigate?: () => void }) {
  const { t } = useT();
  return (
    <nav className="flex-1 space-y-1">
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
navItemClass(isActive)
              )
            }
          >
            <item.icon className="text-[15px] leading-none shrink-0 opacity-80" aria-hidden="true" />
            {t(item.labelKey)}
          </NavLink>
        ))}
    </nav>
  );
}

function LogoBlock() {
  return (
    <div className="flex items-center gap-2.5 px-2 pt-1 pb-5 shrink-0">
      <img src="/logo-white-tight.svg" alt="do action" className="h-12 w-auto" />
      <span className="ml-auto text-[10px] font-semibold tracking-[0.08em] text-faint-ink">ADMIN</span>
    </div>
  );
}

/** Jump-to-clients shortcut styled as the mockup's search field. */
function SearchShortcut({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <NavLink
      to="/admin/clients"
      onClick={onNavigate}
      className="mb-3 flex h-10 items-center gap-2 rounded-[10px] border border-[#2E2E2B] bg-[#1B1B19] px-3 text-[13px] text-[#A9A8A2] hover:text-white"
    >
      <FaMagnifyingGlass className="text-[13px]" aria-hidden="true" />
      ค้นหาลูกค้า…
    </NavLink>
  );
}

/** Above logout — full contact page with LINE / phone / social / email. */
function ClientContactNavLink({ onNavigate }: { onNavigate?: () => void }) {
  const { t } = useT();
  return (
    <div className="pt-2 shrink-0">
      <NavLink
        to="/contact"
        onClick={onNavigate}
        className={({ isActive }) =>
          cn(
navItemClass(isActive)
          )
        }
      >
        <FaHeadset className="text-[15px] leading-none shrink-0 opacity-80" aria-hidden="true" />
        {t("nav_contact_team")}
      </NavLink>
    </div>
  );
}

function LogoutButton() {
  const { t } = useT();
  return (
    <div className="pt-2 mt-2 border-t border-[#2A2A28] shrink-0">
      <Form method="post" action="/logout">
        <button
          type="submit"
          className="flex items-center gap-2.5 w-full h-10 px-3 rounded-[10px] text-sm font-medium text-[#A9A8A2] hover:text-white hover:bg-white/5 transition-colors"
        >
          <FaArrowRightFromBracket className="text-[15px] leading-none opacity-80" aria-hidden="true" />
          {t("nav_logout")}
        </button>
      </Form>
    </div>
  );
}

function SidebarContent({
  role,
  companyName,
  navBadges,
  onNavigate,
}: SidebarProps & { onNavigate?: () => void }) {
  const { t } = useT();
  const nav = role === "co-admin" ? coAdminNav : role === "admin" ? adminNav : clientNav;
  return (
    <div className="flex h-full flex-col bg-ink px-3.5 py-5 text-white">
      <LogoBlock />
      {role === "admin" || role === "co-admin" ? <SearchShortcut onNavigate={onNavigate} /> : null}
      <ScrollArea className="flex-1">
        <NavItems nav={nav} onNavigate={onNavigate} navBadges={navBadges} />
      </ScrollArea>
      {role === "client" ? <ClientContactNavLink onNavigate={onNavigate} /> : null}
      <LogoutButton />
    </div>
  );
}

/** Desktop sidebar (always visible, 240 px wide). */
export function DesktopSidebar({ role, companyName, navBadges }: SidebarProps) {
  return (
    <aside className="w-[248px] shrink-0 hidden lg:flex flex-col h-full">
      <SidebarContent role={role} companyName={companyName} navBadges={navBadges} />
    </aside>
  );
}

/** Mobile sidebar trigger + Sheet. */
export function MobileSidebarTrigger({ role, companyName, navBadges }: SidebarProps) {
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
      <SheetContent side="left" className="w-[260px] p-0 border-0 bg-ink">
        <SidebarContent
          role={role}
          companyName={companyName}
          navBadges={navBadges}
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

/** Client header nav: pill tabs, shown from tablet width up. */
export function ClientTopNav({ navBadges }: { navBadges?: NavBadges }) {
  const { t } = useT();
  return (
    <nav className="hidden md:flex items-center gap-1">
      {clientNav
        .filter((item) => item.href !== "/settings")
        .map((item) => (
          <NavLink
            key={item.href}
            to={item.href}
            end={item.end}
            prefetch="intent"
            className={({ isActive }) =>
              cn(
                "flex h-9 items-center gap-1.5 rounded-full px-3.5 text-sm font-medium transition-colors",
                isActive ? "bg-ink text-white" : "text-muted-ink hover:text-ink hover:bg-paper"
              )
            }
          >
            {t(item.labelKey)}
            {(navBadges?.[item.href] ?? 0) > 0 && (
              <span className="rounded-full bg-brand-yellow px-[7px] py-px text-[11px] font-bold text-ink">
                {navBadges![item.href]}
              </span>
            )}
          </NavLink>
        ))}
    </nav>
  );
}

/** Client bottom tab bar on phones, with a raised "new ticket" action. */
export function ClientBottomNav() {
  const { t } = useT();
  const tab = (item: NavItem) => (
    <NavLink
      key={item.href}
      to={item.href}
      end={item.end}
      prefetch="intent"
      className={({ isActive }) =>
        cn(
          "flex h-[52px] flex-col items-center justify-center gap-1 text-[11px]",
          isActive ? "font-semibold text-ink" : "text-faint-ink"
        )
      }
    >
      <item.icon className="text-lg" aria-hidden="true" />
      {/* Long labels ("รายงานประจำเดือน") keep to one line in a narrow tab */}
      <span className="max-w-full truncate px-1 whitespace-nowrap">{t(item.labelKey)}</span>
    </NavLink>
  );
  return (
    <nav className="md:hidden fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 items-end border-t border-line bg-white px-2 pt-1.5 pb-[max(env(safe-area-inset-bottom),12px)]">
      {tab(clientNav[0])}
      {tab(clientNav[1])}
      <NavLink
        to="/tickets/new"
        aria-label={t("nav_tickets")}
        className="mx-auto -mb-1 flex h-14 w-14 items-center justify-center rounded-full bg-ink text-brand-yellow shadow-[0_6px_16px_rgba(0,0,0,0.2)]"
      >
        <FaPlus className="text-xl" aria-hidden="true" />
      </NavLink>
      {tab(clientNav[2])}
      {tab(clientNav[4])}
    </nav>
  );
}
