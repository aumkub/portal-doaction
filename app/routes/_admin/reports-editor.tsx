/**
 * Shared component used by both /admin/reports/new and /admin/reports/:reportId
 * A client-side interactive form for creating/editing reports with dynamic tasks.
 */
import { useState } from "react";
import { Form } from "react-router";
import { PlusCircle, Trash2, GripVertical } from "lucide-react";
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

interface TaskDraft {
  id: string;      // temp ID for UI key
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

const categoryOptions: { value: TaskCategory; label: string }[] = [
  { value: "maintenance", label: "🔧 Maintenance" },
  { value: "development", label: "💻 Development" },
  { value: "security", label: "🔒 Security" },
  { value: "seo", label: "📈 SEO" },
  { value: "performance", label: "⚡ Performance" },
  { value: "other", label: "📌 อื่นๆ" },
];

const MONTHS = [
  "มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน",
  "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม",
];

function makeDraftId() {
  return `draft-${Math.random().toString(36).slice(2)}`;
}

export default function ReportEditor({
  report,
  tasks = [],
  clients,
  isNew,
  errors,
}: ReportEditorProps) {
  const currentYear = new Date().getFullYear();

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

  const addTask = () => {
    setTaskDrafts((prev) => [
      ...prev,
      { id: makeDraftId(), category: "maintenance", title: "", description: "" },
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
        <h2 className="text-sm font-semibold text-slate-900">ข้อมูลทั่วไป</h2>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {/* Client */}
          <div className="space-y-1.5">
            <Label htmlFor="client_id">ลูกค้า</Label>
            <select
              id="client_id"
              name="client_id"
              defaultValue={report?.client_id ?? ""}
              required
              className="w-full h-10 rounded-lg border border-slate-200 px-3 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-slate-900"
            >
              <option value="" disabled>เลือกลูกค้า</option>
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
            <Label htmlFor="year">ปี (ค.ศ.)</Label>
            <Input
              id="year"
              name="year"
              type="number"
              defaultValue={report?.year ?? currentYear}
              min={2020}
              max={currentYear + 2}
              required
            />
          </div>

          {/* Month */}
          <div className="space-y-1.5">
            <Label htmlFor="month">เดือน</Label>
            <select
              id="month"
              name="month"
              defaultValue={report?.month ?? new Date().getMonth() + 1}
              required
              className="w-full h-10 rounded-lg border border-slate-200 px-3 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-slate-900"
            >
              {MONTHS.map((m, i) => (
                <option key={i + 1} value={i + 1}>
                  {m}
                </option>
              ))}
            </select>
          </div>

          {/* Title */}
          <div className="space-y-1.5">
            <Label htmlFor="title">ชื่อรายงาน</Label>
            <Input
              id="title"
              name="title"
              defaultValue={report?.title ?? ""}
              placeholder="รายงานประจำเดือน มีนาคม 2569"
              required
            />
          </div>
        </div>

        {/* Summary */}
        <div className="space-y-1.5">
          <Label htmlFor="summary">สรุปภาพรวม (optional)</Label>
          <Textarea
            id="summary"
            name="summary"
            defaultValue={report?.summary ?? ""}
            rows={3}
            placeholder="สรุปงานที่ดำเนินการในเดือนนี้..."
          />
        </div>

        {/* Metrics */}
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="uptime_percent">Uptime %</Label>
            <Input
              id="uptime_percent"
              name="uptime_percent"
              type="number"
              step="0.01"
              min={0}
              max={100}
              defaultValue={report?.uptime_percent ?? ""}
              placeholder="99.95"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="speed_score">Speed Score (0–100)</Label>
            <Input
              id="speed_score"
              name="speed_score"
              type="number"
              min={0}
              max={100}
              defaultValue={report?.speed_score ?? ""}
              placeholder="90"
            />
          </div>
        </div>
      </section>

      {/* ── Tasks ──────────────────────────────────────────────────────────── */}
      <section className="bg-white rounded-xl border border-slate-200 p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-900">
            รายการงาน ({taskDrafts.length})
          </h2>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={addTask}
            className="gap-1.5"
          >
            <PlusCircle className="w-4 h-4" /> เพิ่มงาน
          </Button>
        </div>

        {taskDrafts.length === 0 && (
          <p className="text-slate-400 text-sm py-4 text-center">
            กด "เพิ่มงาน" เพื่อเพิ่มรายการ
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
                placeholder={`งานที่ ${index + 1}`}
                className="h-9 rounded-lg border border-slate-200 px-3 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-slate-900 w-full"
              />

              {/* Description */}
              <input
                value={task.description}
                onChange={(e) =>
                  updateTask(task.id, "description", e.target.value)
                }
                placeholder="รายละเอียด (optional)"
                className="h-9 rounded-lg border border-slate-200 px-3 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-slate-900 w-full"
              />

              {/* Remove */}
              <button
                type="button"
                onClick={() => removeTask(task.id)}
                className="p-1.5 text-slate-300 hover:text-red-500 transition-colors mt-1"
                aria-label="ลบ"
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
          ยกเลิก
        </a>
        <Button
          type="submit"
          name="intent"
          value="draft"
          variant="outline"
        >
          บันทึก Draft
        </Button>
        <Button
          type="submit"
          name="intent"
          value="publish"
          className="bg-violet-600 hover:bg-violet-700 text-white"
        >
          {isNew ? "สร้างและเผยแพร่" : "เผยแพร่รายงาน"}
        </Button>
      </div>
    </Form>
  );
}
