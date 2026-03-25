import { CheckCircle2 } from "lucide-react";
import type { ReportTask, TaskCategory } from "~/types";

const categoryConfig: Record<
  TaskCategory,
  { label: string; icon: string; color: string }
> = {
  maintenance: { label: "Maintenance", icon: "🔧", color: "text-slate-600" },
  development: { label: "Development", icon: "💻", color: "text-blue-600" },
  security: { label: "Security", icon: "🔒", color: "text-red-600" },
  seo: { label: "SEO", icon: "📈", color: "text-emerald-600" },
  performance: { label: "Performance", icon: "⚡", color: "text-amber-600" },
  other: { label: "อื่นๆ", icon: "📌", color: "text-slate-500" },
};

interface TaskListProps {
  tasks: ReportTask[];
}

export default function TaskList({ tasks }: TaskListProps) {
  if (tasks.length === 0) {
    return (
      <p className="text-slate-400 text-sm py-4 text-center">ไม่มีรายการงาน</p>
    );
  }

  // Group by category
  const grouped = tasks.reduce<Record<string, ReportTask[]>>((acc, task) => {
    if (!acc[task.category]) acc[task.category] = [];
    acc[task.category].push(task);
    return acc;
  }, {});

  const orderedCategories = (
    Object.keys(categoryConfig) as TaskCategory[]
  ).filter((cat) => grouped[cat]?.length);

  return (
    <div className="space-y-6">
      {orderedCategories.map((cat) => {
        const conf = categoryConfig[cat];
        const catTasks = grouped[cat];
        return (
          <div key={cat}>
            {/* Category header */}
            <div className="flex items-center gap-2 mb-3">
              <span className="text-base">{conf.icon}</span>
              <h3 className={`text-sm font-semibold ${conf.color}`}>
                {conf.label}
              </h3>
              <span className="text-xs text-slate-400 ml-auto">
                {catTasks.length} รายการ
              </span>
            </div>

            {/* Tasks */}
            <ul className="space-y-2">
              {catTasks.map((task) => (
                <li
                  key={task.id}
                  className="flex items-start gap-3 p-3 rounded-lg bg-slate-50 hover:bg-slate-100 transition-colors"
                >
                  <CheckCircle2 className="w-4 h-4 text-emerald-500 mt-0.5 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-slate-700">
                      {task.title}
                    </p>
                    {task.description && (
                      <p className="text-xs text-slate-400 mt-0.5 leading-relaxed">
                        {task.description}
                      </p>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}
