/**
 * Shared component used by both /admin/reports/new and /admin/reports/:reportId
 * A client-side interactive form for creating/editing reports with dynamic tasks.
 */
import { useState, useCallback, useMemo, useEffect, useRef, type ReactNode } from "react";
import { Form } from "react-router";
import { Plus, Trash2, Loader2, Search, Check } from "lucide-react";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { NativeSelect } from "~/components/ui/native-select";
import { Textarea } from "~/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import type { MonthlyReport, ReportTask, Client, TaskCategory } from "~/types";
import { useT } from "~/lib/i18n";
import type { Lang } from "~/lib/translations";
import { getMonthName } from "~/lib/utils";
import type { TranslationKey } from "~/lib/translations";

const categoryEmoji: Record<TaskCategory, string> = {
  maintenance: "🔧",
  development: "💻",
  security: "🔒",
  seo: "📈",
  performance: "⚡",
  other: "📌",
};

const categoryDot: Record<TaskCategory, string> = {
  maintenance: "bg-[#2F6FED]",
  development: "bg-[#7C5CFC]",
  security: "bg-[#B4541A]",
  seo: "bg-[#1F9D6B]",
  performance: "bg-[#E8B400]",
  other: "bg-[#9A968C]",
};

const categoryKey: Record<TaskCategory, TranslationKey> = {
  maintenance: "cat_maintenance",
  development: "cat_development",
  security: "cat_security",
  seo: "cat_seo",
  performance: "cat_performance",
  other: "cat_other",
};

const SHORT_TH = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
const SHORT_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

interface TaskDraft {
  id: string;
  category: TaskCategory;
  title: string;
  description: string;
}

interface ReportEditorProps {
  report?: MonthlyReport;
  tasks?: ReportTask[];
  clients: Client[];
  isNew: boolean;
  errors?: Record<string, string[]>;
  /** `${client_id}-${year}-${month}` keys of reports that already exist (create mode) */
  existingReportKeys?: string[];
}

/** Common tasks — Thai (default) */
const PRESET_TASKS_TH: { category: TaskCategory; title: string; description?: string }[] = [
  { category: "maintenance", title: "อัพเดทปลั๊กอิน", description: "อัพเดทปลั๊กอินทั้งหมดให้เป็นเวอร์ชันล่าสุด" },
  { category: "maintenance", title: "อัพเดทธีม", description: "อัพเดทธีมให้เป็นเวอร์ชันล่าสุด" },
  { category: "maintenance", title: "ตรวจสอบการทำงานปกติของเว็บไซต์", description: "ตรวจสอบหน้าหลัก ฟอร์ม และระบบต่างๆ" },
  { category: "maintenance", title: "Backup website", description: "สำรองข้อมูลเว็บไซต์และฐานข้อมูล" },
  { category: "security", title: "ตรวจสอบความปลอดภัย", description: "สแกนและตรวจสอบช่องโหว่ความปลอดภัย" },
  { category: "seo", title: "ตรวจสอบ SEO", description: "ตรวจสอบ sitemap, robots.txt และ meta tags" },
  { category: "performance", title: "ตรวจสอบความเร็วเว็บไซต์", description: "วัดและบันทึกค่า Core Web Vitals" },
  { category: "maintenance", title: "อัพเดท WordPress Core", description: "อัพเดท WordPress ให้เป็นเวอร์ชันล่าสุด" },
];

const PRESET_TASKS_EN: { category: TaskCategory; title: string; description?: string }[] = [
  { category: "maintenance", title: "Update plugins", description: "Update all plugins to the latest versions" },
  { category: "maintenance", title: "Update theme", description: "Update the theme to the latest version" },
  { category: "maintenance", title: "Site health check", description: "Check homepage, forms, and key flows" },
  { category: "maintenance", title: "Website backup", description: "Back up site files and database" },
  { category: "security", title: "Security review", description: "Scan and review common vulnerabilities" },
  { category: "seo", title: "SEO check", description: "Review sitemap, robots.txt, and meta tags" },
  { category: "performance", title: "Performance check", description: "Measure and record Core Web Vitals" },
  { category: "maintenance", title: "Update WordPress core", description: "Update WordPress to the latest version" },
];

function makeDraftId() {
  return `draft-${Math.random().toString(36).slice(2)}`;
}

function autoTitle(month: number, year: number, lang: Lang) {
  const m = getMonthName(month, lang);
  if (lang === "en") return `Monthly report ${m} ${year}`;
  return `รายงานประจำเดือน ${m} ${year + 543}`;
}

const fieldCls =
  "h-10 w-full rounded-xl border border-line bg-white px-3.5 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-ink/10 focus:border-ink/40";

function StepCard({
  step,
  title,
  helper,
  aside,
  children,
}: {
  step: number;
  title: string;
  helper: string;
  aside?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="rounded-[20px] border border-line bg-white p-4 sm:p-6 space-y-4 min-w-0">
      <div className="flex items-start gap-3">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-ink text-[13px] font-bold text-white">
          {step}
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-[16px] font-semibold text-ink leading-7">{title}</h2>
          <p className="text-[13px] text-muted-ink">{helper}</p>
        </div>
        {aside}
      </div>
      {children}
    </section>
  );
}

export default function ReportEditor({
  report,
  tasks = [],
  clients,
  isNew,
  errors,
  existingReportKeys = [],
}: ReportEditorProps) {
  const { t, lang } = useT();
  const L = (th: string, en: string) => (lang === "en" ? en : th);
  const currentYear = new Date().getFullYear();
  const currentMonth = new Date().getMonth() + 1;

  const initMonth = report?.month ?? currentMonth;
  const initYear = report?.year ?? currentYear;

  const [month, setMonth] = useState(initMonth);
  const [year, setYear] = useState(initYear);
  const [title, setTitle] = useState(
    report?.title && report.title !== ""
      ? report.title
      : autoTitle(initMonth, initYear, lang)
  );
  const [titleManuallyEdited, setTitleManuallyEdited] = useState(
    !!(report?.title && report.title !== "")
  );

  const [sendEmailOnPublish, setSendEmailOnPublish] = useState(true);

  const [uptimePercent, setUptimePercent] = useState<string>(
    report?.uptime_percent != null ? String(report.uptime_percent) : ""
  );
  const [uptimeFetching, setUptimeFetching] = useState(false);
  const [selectedClientId, setSelectedClientId] = useState(report?.client_id ?? "");
  const [selectedClientIds, setSelectedClientIds] = useState<string[]>(
    report?.client_id ? [report.client_id] : []
  );
  const [uptimeOverrides, setUptimeOverrides] = useState<Record<string, string>>({});
  const [uptimeFetchingByClient, setUptimeFetchingByClient] = useState<Record<string, boolean>>({});
  const [clientSearch, setClientSearch] = useState("");

  const presetTasks = lang === "en" ? PRESET_TASKS_EN : PRESET_TASKS_TH;

  const categoryOptions = useMemo(
    () =>
      (Object.keys(categoryKey) as TaskCategory[]).map((value) => ({
        value,
        label: `${categoryEmoji[value]} ${t(categoryKey[value])}`,
      })),
    [t]
  );

  const [taskDrafts, setTaskDrafts] = useState<TaskDraft[]>(
    tasks.length > 0
      ? tasks.map((t) => ({
          id: makeDraftId(),
          category: t.category,
          title: t.title,
          description: t.description ?? "",
        }))
      : [{ id: makeDraftId(), category: "maintenance", title: "", description: "" }]
  );

  // ── Existing-report detection (create mode) ─────────────────────────────
  const existingSet = useMemo(() => new Set(existingReportKeys), [existingReportKeys]);
  const hasReport = useCallback(
    (clientId: string) => existingSet.has(`${clientId}-${year}-${month}`),
    [existingSet, year, month]
  );

  useEffect(() => {
    if (!isNew) return;
    setSelectedClientIds((prev) => {
      const next = prev.filter((id) => !hasReport(id));
      return next.length === prev.length ? prev : next;
    });
  }, [isNew, hasReport]);

  const handleMonthChange = (newMonth: number) => {
    setMonth(newMonth);
    if (!titleManuallyEdited) {
      setTitle(autoTitle(newMonth, year, lang));
    }
  };

  const handleYearChange = (newYear: number) => {
    setYear(newYear);
    if (!titleManuallyEdited) {
      setTitle(autoTitle(month, newYear, lang));
    }
  };

  const handleClientChange = useCallback(async (clientId: string) => {
    setSelectedClientId(clientId);
    if (!clientId) return;
    setUptimeFetching(true);
    try {
      const resp = await fetch(`/api/uptime?clientId=${clientId}`);
      if (resp.ok) {
        const data = await resp.json() as { uptimeRatio: number | null };
        if (data.uptimeRatio != null) {
          setUptimePercent(data.uptimeRatio.toFixed(2));
        }
      }
    } catch {
      // ignore
    } finally {
      setUptimeFetching(false);
    }
  }, []);

  const fetchUptimeFor = useCallback(async (clientId: string) => {
    setUptimeFetchingByClient((prev) => ({ ...prev, [clientId]: true }));
    try {
      const resp = await fetch(`/api/uptime?clientId=${clientId}`);
      if (resp.ok) {
        const data = (await resp.json()) as { uptimeRatio: number | null };
        if (data.uptimeRatio != null) {
          setUptimeOverrides((prev) => ({
            ...prev,
            [clientId]: data.uptimeRatio!.toFixed(2),
          }));
        }
      }
    } catch {
      // ignore
    } finally {
      setUptimeFetchingByClient((prev) => ({ ...prev, [clientId]: false }));
    }
  }, []);

  const handleToggleClient = useCallback((clientId: string, checked: boolean) => {
    setSelectedClientIds((prev) =>
      checked ? (prev.includes(clientId) ? prev : [...prev, clientId]) : prev.filter((id) => id !== clientId)
    );
    if (!checked || uptimeOverrides[clientId] != null) return;
    void fetchUptimeFor(clientId);
  }, [uptimeOverrides, fetchUptimeFor]);

  const selectAllAvailable = () => {
    const available = clients.filter((c) => !hasReport(c.id)).map((c) => c.id);
    const toAdd = available.filter((id) => !selectedClientIds.includes(id));
    setSelectedClientIds((prev) => [...prev, ...toAdd.filter((id) => !prev.includes(id))]);
    toAdd.forEach((id) => {
      if (uptimeOverrides[id] == null) void fetchUptimeFor(id);
    });
  };

  const filteredClients = useMemo(() => {
    const q = clientSearch.trim().toLowerCase();
    if (!q) return clients;
    return clients.filter(
      (c) =>
        c.company_name.toLowerCase().includes(q) ||
        (c.website_url ?? "").toLowerCase().includes(q)
    );
  }, [clients, clientSearch]);

  // ── Tasks ────────────────────────────────────────────────────────────────
  const inputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const [focusId, setFocusId] = useState<string | null>(null);
  useEffect(() => {
    if (focusId && inputRefs.current[focusId]) {
      inputRefs.current[focusId]!.focus();
      setFocusId(null);
    }
  }, [focusId, taskDrafts]);

  const addTaskIn = (category: TaskCategory, afterId?: string) => {
    const id = makeDraftId();
    const draft: TaskDraft = { id, category, title: "", description: "" };
    setTaskDrafts((prev) => {
      if (!afterId) return [...prev, draft];
      const idx = prev.findIndex((d) => d.id === afterId);
      if (idx < 0) return [...prev, draft];
      return [...prev.slice(0, idx + 1), draft, ...prev.slice(idx + 1)];
    });
    setFocusId(id);
  };

  const addPresetTask = (preset: (typeof PRESET_TASKS_TH)[number]) => {
    // Don't add duplicate titles
    if (taskDrafts.some((t) => t.title === preset.title)) return;
    setTaskDrafts((prev) => [
      ...prev,
      {
        id: makeDraftId(),
        category: preset.category,
        title: preset.title,
        description: preset.description ?? "",
      },
    ]);
  };

  const removeTask = (id: string) => {
    setTaskDrafts((prev) => prev.filter((t) => t.id !== id));
  };

  const updateTask = (id: string, field: keyof TaskDraft, value: string) => {
    setTaskDrafts((prev) =>
      prev.map((t) => (t.id === id ? { ...t, [field]: value } : t))
    );
  };

  const filledTasks = taskDrafts.filter((d) => d.title.trim() !== "");
  const groups = categoryOptions.map((o) => ({
    ...o,
    tasks: taskDrafts.filter((d) => d.category === o.value),
    filled: filledTasks.filter((d) => d.category === o.value).length,
  }));
  const activeGroups = groups.filter((g) => g.tasks.length > 0);
  const emptyGroups = groups.filter((g) => g.tasks.length === 0);

  // ── Summary / validation ─────────────────────────────────────────────────
  const monthLabel =
    lang === "en" ? `${getMonthName(month, "en")} ${year}` : `${getMonthName(month, "th")} ${year + 543}`;
  const selectedClient = clients.find((c) => c.id === selectedClientId);
  const noClient = isNew ? selectedClientIds.length === 0 : !selectedClientId;
  const noTasks = filledTasks.length === 0;
  const blocked = noClient || noTasks;
  const blockHint = noClient
    ? L("เลือกลูกค้าอย่างน้อย 1 ราย", "Select at least one client")
    : noTasks
      ? L("เพิ่มงานอย่างน้อย 1 รายการ", "Add at least one task")
      : "";
  const clientLine = isNew
    ? L(`${selectedClientIds.length} ลูกค้า`, `${selectedClientIds.length} client${selectedClientIds.length === 1 ? "" : "s"}`)
    : selectedClient?.company_name ?? "—";

  const yearOptions = useMemo(() => {
    const set = new Set<number>();
    for (let y = currentYear - 3; y <= currentYear + 2; y++) set.add(y);
    set.add(initYear);
    return [...set].sort((a, b) => a - b);
  }, [currentYear, initYear]);

  const emailToggle = isNew ? (
    <label className="flex cursor-pointer items-start gap-3 rounded-2xl bg-paper px-3.5 py-3">
      <button
        type="button"
        role="switch"
        aria-checked={sendEmailOnPublish}
        onClick={() => setSendEmailOnPublish((v) => !v)}
        className={`relative mt-0.5 h-5 w-9 shrink-0 rounded-full transition-colors ${sendEmailOnPublish ? "bg-ink" : "bg-line"}`}
      >
        <span
          className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${sendEmailOnPublish ? "left-[18px]" : "left-0.5"}`}
        />
      </button>
      <span className="min-w-0">
        <span className="block text-[13px] font-medium text-ink">{t("admin_editor_send_email_on_publish")}</span>
        <span className="block text-xs text-muted-ink mt-0.5">{t("admin_editor_send_email_hint")}</span>
      </span>
    </label>
  ) : null;

  // Phone bar: the same switch, one line, so the bar stays short.
  const emailToggleCompact = isNew ? (
    <button
      type="button"
      role="switch"
      aria-checked={sendEmailOnPublish}
      onClick={() => setSendEmailOnPublish((v) => !v)}
      className="mr-auto inline-flex min-w-0 items-center gap-2 text-xs font-medium text-ink-soft"
    >
      <span className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${sendEmailOnPublish ? "bg-ink" : "bg-line"}`}>
        <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${sendEmailOnPublish ? "left-[18px]" : "left-0.5"}`} />
      </span>
      <span className="whitespace-nowrap">{L("อีเมล", "Email")}</span>
    </button>
  ) : null;

  const actionButtons = (
    <>
      <Button
        type="submit"
        name="intent"
        value="draft"
        variant="outline"
        disabled={blocked}
        className="h-10 px-5"
      >
        {t("admin_editor_save_draft")}
      </Button>
      <Button
        type="submit"
        name="intent"
        value="publish"
        disabled={blocked}
        className="h-10 px-5"
      >
        {isNew ? t("admin_editor_publish_new") : t("admin_editor_publish")}
      </Button>
    </>
  );

  return (
    <Form method="post" className="min-w-0">
      {/* Hidden serialized tasks */}
      <input
        type="hidden"
        name="tasks_json"
        value={JSON.stringify(
          categoryOptions
            .flatMap((o) => filledTasks.filter((d) => d.category === o.value))
            .concat(filledTasks.filter((d) => !categoryOptions.some((o) => o.value === d.category)))
            .map(({ id: _id, ...t }) => t)
        )}
      />
      {isNew && (
        <>
          <input
            type="hidden"
            name="client_ids_json"
            value={JSON.stringify(selectedClientIds)}
          />
          <input
            type="hidden"
            name="uptime_overrides_json"
            value={JSON.stringify(uptimeOverrides)}
          />
          <input type="hidden" name="send_email" value={sendEmailOnPublish ? "1" : "0"} />
        </>
      )}
      <input type="hidden" name="month" value={month} />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,720px)_minmax(260px,1fr)] lg:items-start">
        <div className="space-y-5 min-w-0">
          {/* ① Client */}
          <StepCard
            step={1}
            title={L("ลูกค้า", "Client")}
            helper={
              isNew
                ? L("เลือกได้หลายราย — ระบบจะสร้างรายงานแยกให้แต่ละราย", "Pick one or more — a separate report is created for each")
                : L("ลูกค้าที่รายงานนี้เป็นของ", "The client this report belongs to")
            }
          >
            {isNew ? (
              <div className="space-y-3">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-faint-ink" />
                  <input
                    type="search"
                    value={clientSearch}
                    onChange={(e) => setClientSearch(e.target.value)}
                    placeholder={L("ค้นหาลูกค้า", "Search clients")}
                    className={`${fieldCls} pl-10`}
                  />
                </div>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px]">
                  <button type="button" onClick={selectAllAvailable} className="font-semibold text-ink underline-offset-4 hover:underline">
                    {L("เลือกทั้งหมดที่ยังไม่มีรายงาน", "Select all without a report")}
                  </button>
                  <button type="button" onClick={() => setSelectedClientIds([])} className="font-medium text-muted-ink underline-offset-4 hover:text-ink hover:underline">
                    {L("ล้าง", "Clear")}
                  </button>
                  <span className="ml-auto text-muted-ink tabular-nums">
                    {L(`เลือกแล้ว ${selectedClientIds.length}`, `${selectedClientIds.length} selected`)}
                  </span>
                </div>
                <div className="grid max-h-72 grid-cols-1 gap-1.5 overflow-y-auto sm:grid-cols-2">
                  {filteredClients.map((c) => {
                    const checked = selectedClientIds.includes(c.id);
                    const exists = hasReport(c.id);
                    return (
                      <button
                        key={c.id}
                        type="button"
                        disabled={exists}
                        aria-pressed={checked}
                        onClick={() => handleToggleClient(c.id, !checked)}
                        className={`flex min-h-12 min-w-0 items-center gap-3 rounded-xl border px-3 py-2 text-left transition-colors ${
                          exists
                            ? "cursor-not-allowed border-line-soft bg-paper opacity-60"
                            : checked
                              ? "border-ink bg-ink/[0.03]"
                              : "border-line bg-white hover:border-ink/30"
                        }`}
                      >
                        <span
                          className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${
                            checked ? "border-ink bg-ink text-white" : "border-line bg-white"
                          }`}
                        >
                          {checked && <Check className="h-3 w-3" strokeWidth={3} />}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium text-ink">{c.company_name}</span>
                          {exists ? (
                            <span className="mt-0.5 inline-flex rounded-full bg-[#FFF6C2] px-2 py-px text-[11px] font-semibold text-[#6B5B00]">
                              {L("มีรายงานเดือนนี้แล้ว", "Report exists")}
                            </span>
                          ) : (
                            <span className="block truncate text-xs text-muted-ink">
                              {c.website_url?.replace(/^https?:\/\//, "") ?? t("admin_editor_no_domain")}
                            </span>
                          )}
                        </span>
                      </button>
                    );
                  })}
                  {filteredClients.length === 0 && (
                    <p className="py-4 text-center text-sm text-muted-ink sm:col-span-2">
                      {L("ไม่พบลูกค้า", "No clients found")}
                    </p>
                  )}
                </div>
                {errors?.client_ids_json && (
                  <p className="text-[#B4541A] text-xs">{errors.client_ids_json[0]}</p>
                )}
              </div>
            ) : (
              <div className="space-y-1.5">
                <NativeSelect
                  id="client_id"
                  name="client_id"
                  value={selectedClientId}
                  onChange={(e) => handleClientChange(e.target.value)}
                  required
                >
                  <option value="" disabled>
                    {t("admin_editor_select_client")}
                  </option>
                  {clients.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.company_name}
                    </option>
                  ))}
                </NativeSelect>
                {errors?.client_id && (
                  <p className="text-[#B4541A] text-xs">{errors.client_id[0]}</p>
                )}
              </div>
            )}
          </StepCard>

          {/* ② Month */}
          <StepCard
            step={2}
            title={L("เดือน", "Month")}
            helper={L("รายงานนี้สรุปงานของเดือนไหน", "Which month this report covers")}
            aside={
              <NativeSelect
                id="year"
                name="year"
                value={year}
                onChange={(e) => handleYearChange(Number(e.target.value))}
                wrapperClassName="w-28 shrink-0"
                aria-label={t("admin_editor_year_ad")}
                required
              >
                {yearOptions.map((y) => (
                  <option key={y} value={y}>
                    {lang === "en" ? y : y + 543}
                  </option>
                ))}
              </NativeSelect>
            }
          >
            <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
              {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => {
                const active = m === month;
                const isNow = m === currentMonth && year === currentYear;
                return (
                  <button
                    key={m}
                    type="button"
                    aria-pressed={active}
                    onClick={() => handleMonthChange(m)}
                    className={`h-10 rounded-xl text-[13px] font-semibold transition-colors ${
                      active
                        ? "bg-ink text-white"
                        : `border bg-white text-ink-soft hover:border-ink/30 ${isNow ? "border-ink/40" : "border-line"}`
                    }`}
                  >
                    {(lang === "en" ? SHORT_EN : SHORT_TH)[m - 1]}
                  </button>
                );
              })}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="title">{t("admin_editor_report_title")}</Label>
              <Input
                id="title"
                name="title"
                value={title}
                onChange={(e) => {
                  setTitle(e.target.value);
                  setTitleManuallyEdited(true);
                }}
                className="h-10 rounded-xl"
                required
              />
            </div>
          </StepCard>

          {/* ③ Tasks */}
          <StepCard
            step={3}
            title={t("admin_editor_tasks_title")}
            helper={L("กด Enter ในช่องชื่องานเพื่อเพิ่มงานถัดไปในหมวดเดียวกัน", "Press Enter in a task title to add the next one in the same category")}
            aside={
              <span className="font-display text-[22px] font-bold leading-7 text-ink tabular-nums">
                {filledTasks.length}
              </span>
            }
          >
            {/* Preset tasks */}
            <div className="rounded-[16px] bg-paper p-3.5 space-y-2.5">
              <p className="text-xs font-medium text-muted-ink">{t("admin_editor_presets_hint")}</p>
              <div className="flex flex-wrap gap-2">
                {presetTasks.map((preset) => {
                  const alreadyAdded = taskDrafts.some((t) => t.title === preset.title);
                  return (
                    <button
                      key={preset.title}
                      type="button"
                      onClick={() => addPresetTask(preset)}
                      disabled={alreadyAdded}
                      className={`inline-flex min-h-8 max-w-full items-center gap-1.5 rounded-full px-3.5 py-1 text-left text-[13px] font-medium transition-colors ${
                        alreadyAdded
                          ? "bg-ink text-white cursor-default"
                          : "border border-line bg-white text-ink-soft hover:border-ink/30"
                      }`}
                    >
                      {alreadyAdded ? "✓ " : "+ "}
                      {preset.title}
                    </button>
                  );
                })}
              </div>
            </div>

            {activeGroups.length === 0 && (
              <p className="py-4 text-center text-sm text-muted-ink">{t("admin_editor_tasks_empty")}</p>
            )}

            <div className="space-y-5">
              {activeGroups.map((group) => (
                <div key={group.value} className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <p className="flex min-w-0 items-center gap-2 text-[13px] font-semibold text-ink">
                      <span className={`h-2 w-2 shrink-0 rounded-full ${categoryDot[group.value]}`} />
                      <span className="truncate">{group.label}</span>
                      <span className="rounded-full bg-paper px-2 py-0.5 text-xs font-semibold text-muted-ink tabular-nums">{group.tasks.length}</span>
                    </p>
                    <button
                      type="button"
                      onClick={() => addTaskIn(group.value)}
                      className="inline-flex h-8 shrink-0 items-center gap-1 rounded-full px-3 text-[13px] font-medium text-muted-ink hover:bg-paper hover:text-ink"
                    >
                      <Plus className="w-3.5 h-3.5" /> {L("เพิ่ม", "Add")}
                    </button>
                  </div>
                  <div className="overflow-hidden rounded-[16px] border border-line">
                    {group.tasks.map((task) => (
                      <div
                        key={task.id}
                        className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 border-b border-line-soft p-3 last:border-0 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_140px_auto] sm:items-center"
                      >
                        <input
                          ref={(el) => {
                            inputRefs.current[task.id] = el;
                          }}
                          value={task.title}
                          onChange={(e) => updateTask(task.id, "title", e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                              e.preventDefault();
                              addTaskIn(task.category, task.id);
                            }
                          }}
                          placeholder={t("admin_editor_task_placeholder")}
                          className={`${fieldCls} font-medium`}
                        />
                        <button
                          type="button"
                          onClick={() => removeTask(task.id)}
                          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-faint-ink hover:bg-[#FDE7DA] hover:text-[#B4541A] transition-colors sm:order-last"
                          aria-label={t("admin_editor_remove_task")}
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                        <input
                          value={task.description}
                          onChange={(e) => updateTask(task.id, "description", e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") e.preventDefault();
                          }}
                          placeholder={t("admin_editor_task_desc_ph")}
                          className={`${fieldCls} col-span-2 text-ink-soft sm:col-span-1`}
                        />
                        <Select
                          value={task.category}
                          onValueChange={(v) => updateTask(task.id, "category", v as TaskCategory)}
                        >
                          <SelectTrigger className="col-span-2 h-10 w-full rounded-xl border-line bg-white text-xs sm:col-span-1">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {categoryOptions.map((o) => (
                              <SelectItem key={o.value} value={o.value} className="text-xs">
                                {o.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            {emptyGroups.length > 0 && (
              <div className="space-y-2 border-t border-line-soft pt-4">
                <p className="text-xs font-medium text-muted-ink">{L("เพิ่มหมวด", "Add category")}</p>
                <div className="flex flex-wrap gap-2">
                  {emptyGroups.map((g) => (
                    <button
                      key={g.value}
                      type="button"
                      onClick={() => addTaskIn(g.value)}
                      className="inline-flex h-8 items-center gap-1.5 rounded-full border border-dashed border-line bg-white px-3 text-[13px] font-medium text-ink-soft hover:border-ink/30"
                    >
                      <Plus className="h-3.5 w-3.5" /> {g.label}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {errors?.tasks_json && (
              <p className="text-[#B4541A] text-xs">{errors.tasks_json[0]}</p>
            )}
          </StepCard>

          {/* ④ Summary & numbers */}
          <StepCard
            step={4}
            title={L("สรุปและตัวเลข", "Summary & numbers")}
            helper={L("ข้อความสรุปถึงลูกค้า และค่า uptime / ความเร็ว", "A note to the client, plus uptime and speed")}
          >
            <div className="space-y-1.5">
              <Label htmlFor="summary">{t("admin_editor_summary")}</Label>
              <Textarea
                id="summary"
                name="summary"
                defaultValue={report?.summary ?? ""}
                rows={4}
                placeholder={t("admin_editor_summary_ph")}
              />
            </div>

            {isNew ? (
              <div className="space-y-2">
                <Label>{t("admin_editor_uptime_per_client")}</Label>
                {selectedClientIds.length === 0 ? (
                  <p className="text-xs text-muted-ink">{t("admin_editor_uptime_select_client_first")}</p>
                ) : (
                  <div className="space-y-2">
                    {selectedClientIds.map((clientId) => {
                      const client = clients.find((c) => c.id === clientId);
                      if (!client) return null;
                      const isLoading = uptimeFetchingByClient[clientId];
                      return (
                        <div key={clientId} className="flex items-center gap-3 rounded-[14px] border border-line-soft bg-paper p-3">
                          <div className="min-w-0 flex-1 text-sm">
                            <p className="truncate font-medium text-ink">{client.company_name}</p>
                            <p className="truncate text-xs text-muted-ink">
                              {client.website_url?.replace(/^https?:\/\//, "") ?? t("admin_editor_no_domain")}
                            </p>
                          </div>
                          {isLoading ? <Loader2 className="w-3.5 h-3.5 shrink-0 animate-spin text-muted-ink" /> : null}
                          <div className="relative w-28 shrink-0">
                            <Input
                              type="number"
                              step="0.01"
                              min={0}
                              max={100}
                              value={uptimeOverrides[clientId] ?? ""}
                              onChange={(e) =>
                                setUptimeOverrides((prev) => ({
                                  ...prev,
                                  [clientId]: e.target.value,
                                }))
                              }
                              placeholder="99.95"
                              aria-label={`${t("admin_editor_uptime_pct")} ${client.company_name}`}
                              className="h-10 rounded-xl pr-7"
                            />
                            <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-ink">%</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="uptime_percent" className="flex items-center gap-2">
                    {t("admin_editor_uptime_pct")}
                    {uptimeFetching && (
                      <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-ink" />
                    )}
                  </Label>
                  <Input
                    id="uptime_percent"
                    name="uptime_percent"
                    type="number"
                    step="0.01"
                    min={0}
                    max={100}
                    value={uptimePercent}
                    onChange={(e) => setUptimePercent(e.target.value)}
                    placeholder="99.95"
                    className="h-10 rounded-xl"
                  />
                  {uptimePercent === "" && !uptimeFetching && selectedClientId && (
                    <p className="text-xs text-muted-ink">{t("admin_editor_uptime_hint")}</p>
                  )}
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="speed_score">{L("คะแนนความเร็ว (0–100)", "Speed score (0–100)")}</Label>
                  <Input
                    id="speed_score"
                    name="speed_score"
                    type="number"
                    step="1"
                    min={0}
                    max={100}
                    defaultValue={report?.speed_score ?? ""}
                    placeholder="90"
                    className="h-10 rounded-xl"
                  />
                </div>
              </div>
            )}
          </StepCard>
        </div>

        {/* ── Summary panel (lg+) ───────────────────────────────────────────── */}
        <aside className="hidden lg:sticky lg:top-4 lg:block">
          <div className="space-y-4 rounded-[20px] border border-line bg-white p-5">
            <div>
              <p className="text-xs font-medium text-muted-ink">{isNew ? L("ลูกค้าที่เลือก", "Selected clients") : t("admin_col_client")}</p>
              {isNew ? (
                <p className="font-display text-[32px] font-bold leading-tight text-ink tabular-nums">
                  {selectedClientIds.length}
                </p>
              ) : (
                <p className="truncate text-[15px] font-semibold text-ink">{clientLine}</p>
              )}
            </div>
            <div>
              <p className="text-xs font-medium text-muted-ink">{L("เดือน", "Month")}</p>
              <p className="text-[15px] font-semibold text-ink">{monthLabel}</p>
            </div>
            <div className="space-y-1.5 border-t border-line-soft pt-4">
              <div className="flex items-baseline justify-between">
                <p className="text-xs font-medium text-muted-ink">{t("admin_editor_tasks_title")}</p>
                <p className="font-display text-[24px] font-bold text-ink tabular-nums">{filledTasks.length}</p>
              </div>
              {groups.filter((g) => g.filled > 0).map((g) => (
                <div key={g.value} className="flex items-center gap-2 text-[13px] text-ink-soft">
                  <span className={`h-2 w-2 rounded-full ${categoryDot[g.value]}`} />
                  <span className="flex-1 truncate">{t(categoryKey[g.value])}</span>
                  <span className="tabular-nums font-semibold text-ink">{g.filled}</span>
                </div>
              ))}
            </div>
            {emailToggle}
            <div className="grid grid-cols-2 gap-2 [&>button]:w-full">{actionButtons}</div>
            {blocked && <p className="text-center text-xs text-muted-ink">{blockHint}</p>}
            <a
              href="/admin/reports"
              className="block text-center text-[13px] font-semibold text-muted-ink hover:text-ink"
            >
              {t("cancel")}
            </a>
          </div>
        </aside>
      </div>

      {/* ── Bottom action bar (< lg) ────────────────────────────────────────── */}
      <div className="sticky bottom-0 z-20 mt-6 space-y-2.5 border-t border-line bg-white/95 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur lg:hidden">
        <p className="truncate text-[13px] text-ink-soft">
          <span className="font-semibold text-ink">{clientLine}</span>
          {" · "}
          {monthLabel}
          {" · "}
          {L(`${filledTasks.length} งาน`, `${filledTasks.length} tasks`)}
          {blocked && <span className="text-muted-ink"> — {blockHint}</span>}
        </p>
        <div className="flex items-center justify-end gap-2">
          {emailToggleCompact ?? <span className="mr-auto" />}
          {actionButtons}
        </div>
      </div>
    </Form>
  );
}
