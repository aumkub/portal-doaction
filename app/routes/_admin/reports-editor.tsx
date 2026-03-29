/**
 * Shared component used by both /admin/reports/new and /admin/reports/:reportId
 * A client-side interactive form for creating/editing reports with dynamic tasks.
 */
import { useState, useCallback, useMemo } from "react";
import { Form } from "react-router";
import { PlusCircle, Trash2, GripVertical, Loader2 } from "lucide-react";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
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

  const [uptimePercent, setUptimePercent] = useState<string>(
    report?.uptime_percent != null ? String(report.uptime_percent) : ""
  );
  const [uptimeFetching, setUptimeFetching] = useState(false);
  const [selectedClientId, setSelectedClientId] = useState(report?.client_id ?? "");

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
          taskDrafts.map(({ id: _id, ...t }) => t)
        )}
      />

      {/* ── Basic Info ─────────────────────────────────────────────────────── */}
      <section className="bg-white rounded-xl border border-slate-200 p-6 space-y-5">
        <h2 className="text-sm font-semibold text-slate-900">
          {t("admin_editor_section_basic")}
        </h2>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {/* Client */}
          <div className="space-y-1.5">
            <Label htmlFor="client_id">{t("admin_col_client")}</Label>
            <select
              id="client_id"
              name="client_id"
              value={selectedClientId}
              onChange={(e) => handleClientChange(e.target.value)}
              required
              className="w-full h-10 rounded-lg border border-slate-200 px-3 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-slate-900"
            >
              <option value="" disabled>
                {t("admin_editor_select_client")}
              </option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.company_name}
                </option>
              ))}
            </select>
            {errors?.client_id && (
              <p className="text-red-500 text-xs">{errors.client_id[0]}</p>
            )}
          </div>

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
            <select
              id="month"
              name="month"
              value={month}
              onChange={(e) => handleMonthChange(Number(e.target.value))}
              required
              className="w-full h-10 rounded-lg border border-slate-200 px-3 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-slate-900"
            >
              {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                <option key={m} value={m}>
                  {getMonthName(m, lang)}
                </option>
              ))}
            </select>
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

        {/* Uptime only */}
        <div className="space-y-1.5 max-w-xs">
          <Label htmlFor="uptime_percent" className="flex items-center gap-2">
            {t("admin_editor_uptime_pct")}
            {uptimeFetching && (
              <Loader2 className="w-3.5 h-3.5 animate-spin text-slate-400" />
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
            <p className="text-xs text-slate-400">{t("admin_editor_uptime_hint")}</p>
          )}
        </div>
      </section>

      {/* ── Tasks ──────────────────────────────────────────────────────────── */}
      <section className="bg-white rounded-xl border border-slate-200 p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-900">
            {t("admin_editor_tasks_title")} ({taskDrafts.length})
          </h2>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={addTask}
            className="gap-1.5"
          >
            <PlusCircle className="w-4 h-4" /> {t("admin_editor_add_task")}
          </Button>
        </div>

        {/* Preset tasks */}
        <div className="space-y-2">
          <p className="text-xs font-medium text-slate-500">
            {t("admin_editor_presets_hint")}
          </p>
          <div className="flex flex-wrap gap-2">
            {presetTasks.map((preset) => {
              const alreadyAdded = taskDrafts.some((t) => t.title === preset.title);
              return (
                <button
                  key={preset.title}
                  type="button"
                  onClick={() => addPresetTask(preset)}
                  disabled={alreadyAdded}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                    alreadyAdded
                      ? "bg-violet-50 border-violet-200 text-violet-400 cursor-default"
                      : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50 hover:border-slate-300"
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
          <p className="text-slate-400 text-sm py-4 text-center">
            {t("admin_editor_tasks_empty")}
          </p>
        )}

        <div className="space-y-3">
          {taskDrafts.map((task, index) => (
            <div
              key={task.id}
              className="grid grid-cols-[auto_1fr_1fr_1fr_auto] gap-2 items-start p-3 border border-slate-100 rounded-lg bg-slate-50 group"
            >
              {/* Drag handle (visual only) */}
              <GripVertical className="w-4 h-4 text-slate-300 mt-2.5 cursor-grab" />

              {/* Category */}
              <Select
                value={task.category}
                onValueChange={(v) =>
                  updateTask(task.id, "category", v as TaskCategory)
                }
              >
                <SelectTrigger className="h-9 text-xs bg-white">
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

              {/* Title */}
              <input
                value={task.title}
                onChange={(e) => updateTask(task.id, "title", e.target.value)}
                placeholder={`${t("admin_editor_task_placeholder")} ${index + 1}`}
                className="h-9 rounded-lg border border-slate-200 px-3 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-slate-900 w-full"
              />

              {/* Description */}
              <input
                value={task.description}
                onChange={(e) =>
                  updateTask(task.id, "description", e.target.value)
                }
                placeholder={t("admin_editor_task_desc_ph")}
                className="h-9 rounded-lg border border-slate-200 px-3 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-slate-900 w-full"
              />

              {/* Remove */}
              <button
                type="button"
                onClick={() => removeTask(task.id)}
                className="p-1.5 text-slate-300 hover:text-red-500 transition-colors mt-1"
                aria-label={t("admin_editor_remove_task")}
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
      </section>

      {/* ── Actions ────────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-3 justify-end">
        <a
          href="/admin/reports"
          className="rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50 transition-colors"
        >
          {t("cancel")}
        </a>
        <Button
          type="submit"
          name="intent"
          value="draft"
          variant="outline"
        >
          {t("admin_editor_save_draft")}
        </Button>
        <Button
          type="submit"
          name="intent"
          value="publish"
          className="bg-violet-600 hover:bg-violet-700 text-white"
        >
          {isNew ? t("admin_editor_publish_new") : t("admin_editor_publish")}
        </Button>
      </div>
    </Form>
  );
}
