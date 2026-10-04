/**
 * Shared component used by both /admin/reports/new and /admin/reports/:reportId
 * A client-side interactive form for creating/editing reports with dynamic tasks.
 */
import { useState, useCallback, useMemo } from "react";
import { Form } from "react-router";
import { PlusCircle, Trash2, Loader2 } from "lucide-react";
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

const categoryKey: Record<TaskCategory, TranslationKey> = {
  maintenance: "cat_maintenance",
  development: "cat_development",
  security: "cat_security",
  seo: "cat_seo",
  performance: "cat_performance",
  other: "cat_other",
};

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

export default function ReportEditor({
  report,
  tasks = [],
  clients,
  isNew,
  errors,
}: ReportEditorProps) {
  const { t, lang } = useT();
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

  const handleToggleClient = useCallback(async (clientId: string, checked: boolean) => {
    setSelectedClientIds((prev) =>
      checked ? [...prev, clientId] : prev.filter((id) => id !== clientId)
    );

    if (!checked || uptimeOverrides[clientId] != null) return;
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
  }, [uptimeOverrides]);

  const addTask = () => {
    setTaskDrafts((prev) => [
      ...prev,
      { id: makeDraftId(), category: "maintenance", title: "", description: "" },
    ]);
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

  return (
    <Form method="post" className="space-y-8">
      {/* Hidden serialized tasks */}
      <input
        type="hidden"
        name="tasks_json"
        value={JSON.stringify(
          categoryOptions
            .flatMap((o) => taskDrafts.filter((d) => d.category === o.value))
            .concat(taskDrafts.filter((d) => !categoryOptions.some((o) => o.value === d.category)))
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
        </>
      )}

      {/* ── Basic Info ─────────────────────────────────────────────────────── */}
      <section className="rounded-[20px] border border-line bg-white p-5 sm:p-6 space-y-5">
        <h2 className="text-[16px] font-semibold text-ink">
          {t("admin_editor_section_basic")}
        </h2>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {/* Client(s) */}
          {isNew ? (
            <div className="space-y-2 sm:col-span-2">
              <Label>{t("admin_editor_select_clients")}</Label>
              <div className="max-h-44 overflow-y-auto rounded-[14px] border border-line bg-white p-2 grid sm:grid-cols-2 gap-1">
                {clients.map((c) => {
                  const checked = selectedClientIds.includes(c.id);
                  return (
                    <label
                      key={c.id}
                      className="flex items-center gap-2 rounded-xl px-3 py-2 hover:bg-paper text-sm text-ink-soft cursor-pointer min-h-10"
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(e) => handleToggleClient(c.id, e.target.checked)}
                        className="h-4 w-4 rounded border-line accent-[#111]"
                      />
                      <span>{c.company_name}</span>
                    </label>
                  );
                })}
              </div>
              {errors?.client_ids_json && (
                <p className="text-[#B4541A] text-xs">{errors.client_ids_json[0]}</p>
              )}
            </div>
          ) : (
            <div className="space-y-1.5">
              <Label htmlFor="client_id">{t("admin_col_client")}</Label>
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

          {/* Year */}
          <div className="space-y-1.5">
            <Label htmlFor="year">{t("admin_editor_year_ad")}</Label>
            <Input
              id="year"
              name="year"
              type="number"
              value={year}
              onChange={(e) => handleYearChange(Number(e.target.value))}
              min={2020}
              max={currentYear + 2}
              required
            />
          </div>

          {/* Month */}
          <div className="space-y-1.5">
            <Label htmlFor="month">{t("admin_editor_month")}</Label>
            <NativeSelect
              id="month"
              name="month"
              value={month}
              onChange={(e) => handleMonthChange(Number(e.target.value))}
              required
            >
              {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                <option key={m} value={m}>
                  {getMonthName(m, lang)}
                </option>
              ))}
            </NativeSelect>
          </div>

          {/* Title */}
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
              required
            />
          </div>
        </div>

        {/* Summary */}
        <div className="space-y-1.5">
          <Label htmlFor="summary">{t("admin_editor_summary")}</Label>
          <Textarea
            id="summary"
            name="summary"
            defaultValue={report?.summary ?? ""}
            rows={3}
            placeholder={t("admin_editor_summary_ph")}
          />
        </div>

        {/* Uptime */}
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
                    <div key={clientId} className="grid grid-cols-1 sm:grid-cols-[1fr_180px] gap-2 items-center rounded-[14px] border border-line bg-paper p-3">
                      <div className="text-sm">
                        <p className="font-medium text-ink">{client.company_name}</p>
                        <p className="text-xs text-muted-ink">
                          {client.website_url?.replace(/^https?:\/\//, "") ?? t("admin_editor_no_domain")}
                        </p>
                      </div>
                      <div className="space-y-1">
                        <div className="flex items-center justify-between">
                          <span className="text-xs text-muted-ink">{t("admin_editor_uptime_pct")}</span>
                          {isLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-ink" /> : null}
                        </div>
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
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-1.5 max-w-xs">
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
            />
            {uptimePercent === "" && !uptimeFetching && selectedClientId && (
              <p className="text-xs text-muted-ink">{t("admin_editor_uptime_hint")}</p>
            )}
          </div>
        )}
      </section>

      {/* ── Tasks (grouped by category) ─────────────────────────────────── */}
      <section className="rounded-[20px] border border-line bg-white p-5 sm:p-6 space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-[16px] font-semibold text-ink">{t("admin_editor_tasks_title")}</h2>
            <p className="text-[13px] text-muted-ink">{taskDrafts.length} {t("items")}</p>
          </div>
          <Button type="button" variant="outline" onClick={addTask} className="gap-1.5">
            <PlusCircle className="w-4 h-4" /> {t("admin_editor_add_task")}
          </Button>
        </div>

        {/* Preset tasks */}
        <div className="rounded-[16px] bg-paper p-4 space-y-2.5">
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
                  className={`inline-flex h-8 items-center gap-1.5 rounded-full px-3.5 text-[13px] font-medium transition-colors ${
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

        {taskDrafts.length === 0 && (
          <div className="flex flex-col items-center gap-3 py-8 text-center">
            <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-paper text-muted-ink"><PlusCircle className="w-5 h-5" /></span>
            <p className="text-sm text-muted-ink">{t("admin_editor_tasks_empty")}</p>
          </div>
        )}

        <div className="space-y-5">
          {categoryOptions
            .map((o) => ({ ...o, tasks: taskDrafts.filter((d) => d.category === o.value) }))
            .filter((g) => g.tasks.length > 0)
            .map((group) => (
              <div key={group.value} className="space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-[13px] font-semibold text-ink">
                    {group.label}
                    <span className="ml-2 rounded-full bg-paper px-2 py-0.5 text-xs font-semibold text-muted-ink tabular-nums">{group.tasks.length}</span>
                  </p>
                  <button
                    type="button"
                    onClick={() =>
                      setTaskDrafts((prev) => [
                        ...prev,
                        { id: makeDraftId(), category: group.value as TaskCategory, title: "", description: "" },
                      ])
                    }
                    className="inline-flex h-8 items-center gap-1 rounded-full px-3 text-[13px] font-medium text-muted-ink hover:bg-paper hover:text-ink"
                  >
                    <PlusCircle className="w-3.5 h-3.5" /> {t("admin_editor_add_task")}
                  </button>
                </div>
                <div className="overflow-hidden rounded-[16px] border border-line">
                  {group.tasks.map((task) => (
                    <div
                      key={task.id}
                      className="grid grid-cols-1 gap-2 border-b border-[#F4F2EC] p-3 last:border-0 sm:grid-cols-[1fr_1fr_150px_auto] sm:items-center"
                    >
                      <input
                        value={task.title}
                        onChange={(e) => updateTask(task.id, "title", e.target.value)}
                        placeholder={t("admin_editor_task_placeholder")}
                        className="h-10 w-full rounded-xl border border-line bg-white px-3.5 text-sm font-medium text-ink focus:outline-none focus:ring-2 focus:ring-ink/10 focus:border-ink/40"
                      />
                      <input
                        value={task.description}
                        onChange={(e) => updateTask(task.id, "description", e.target.value)}
                        placeholder={t("admin_editor_task_desc_ph")}
                        className="h-10 w-full rounded-xl border border-line bg-white px-3.5 text-sm text-ink-soft focus:outline-none focus:ring-2 focus:ring-ink/10 focus:border-ink/40"
                      />
                      <div className="flex items-center gap-2">
                        <Select
                          value={task.category}
                          onValueChange={(v) => updateTask(task.id, "category", v as TaskCategory)}
                        >
                          <SelectTrigger className="h-10 flex-1 rounded-xl border-line bg-white text-xs">
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
                        <button
                          type="button"
                          onClick={() => removeTask(task.id)}
                          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-faint-ink hover:bg-[#FDE7DA] hover:text-[#B4541A] transition-colors sm:hidden"
                          aria-label={t("admin_editor_remove_task")}
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                      <button
                        type="button"
                        onClick={() => removeTask(task.id)}
                        className="hidden h-10 w-10 items-center justify-center rounded-full text-faint-ink hover:bg-[#FDE7DA] hover:text-[#B4541A] transition-colors sm:flex"
                        aria-label={t("admin_editor_remove_task")}
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            ))}
        </div>
      </section>

      {/* ── Actions ────────────────────────────────────────────────────────── */}
      {/* Hidden: send email flag (only meaningful on publish) */}
      {isNew && (
        <input type="hidden" name="send_email" value={sendEmailOnPublish ? "1" : "0"} />
      )}

      <div className="space-y-3">
        {/* Send email toggle — only on new publish */}
        {isNew && (
          <div className="flex items-start gap-3 rounded-[20px] border border-line bg-white px-5 py-4">
            <input
              id="send_email_toggle"
              type="checkbox"
              checked={sendEmailOnPublish}
              onChange={(e) => setSendEmailOnPublish(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-line accent-[#111] cursor-pointer"
            />
            <label htmlFor="send_email_toggle" className="cursor-pointer">
              <span className="block text-sm font-medium text-ink">
                {t("admin_editor_send_email_on_publish")}
              </span>
              <span className="block text-xs text-muted-ink mt-0.5">
                {t("admin_editor_send_email_hint")}
              </span>
            </label>
          </div>
        )}

        <div className="sticky bottom-0 z-10 -mx-1 flex flex-wrap items-center justify-end gap-2 rounded-[20px] border border-line bg-white/95 px-4 py-3 backdrop-blur">
          <a
            href="/admin/reports"
            className="mr-auto inline-flex h-10 items-center rounded-full px-4 text-[13px] font-semibold text-muted-ink hover:bg-paper hover:text-ink transition-colors"
          >
            {t("cancel")}
          </a>
          <Button
            type="submit"
            name="intent"
            value="draft"
            variant="outline"
            disabled={isNew && selectedClientIds.length === 0}
          >
            {t("admin_editor_save_draft")}
          </Button>
          <Button
            type="submit"
            name="intent"
            value="publish"
            disabled={isNew && selectedClientIds.length === 0}
          >
            {isNew ? t("admin_editor_publish_new") : t("admin_editor_publish")}
          </Button>
        </div>
      </div>
    </Form>
  );
}
