import { FaCircleCheck, FaWrench, FaCode, FaLock, FaChartLine, FaBolt, FaTag } from "react-icons/fa6";
import type { ReportTask, TaskCategory } from "~/types";

const categoryConfig: Record<TaskCategory, { label: string; icon: React.ReactNode; badgeCls: string; iconCls: string }> = {
  maintenance: { label: "บำรุงรักษา", icon: <FaWrench />,     badgeCls: "bg-slate-100 text-slate-600 ring-1 ring-slate-200",   iconCls: "text-slate-500" },
  development: { label: "พัฒนา",      icon: <FaCode />,       badgeCls: "bg-blue-50 text-blue-700 ring-1 ring-blue-200",       iconCls: "text-blue-500" },
  security:    { label: "ความปลอดภัย",icon: <FaLock />,       badgeCls: "bg-red-50 text-red-700 ring-1 ring-red-200",          iconCls: "text-red-500" },
  seo:         { label: "SEO",         icon: <FaChartLine />,  badgeCls: "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200",iconCls: "text-emerald-500" },
  performance: { label: "ประสิทธิภาพ",icon: <FaBolt />,       badgeCls: "bg-amber-50 text-amber-700 ring-1 ring-amber-200",    iconCls: "text-amber-500" },
  other:       { label: "อื่นๆ",       icon: <FaTag />,        badgeCls: "bg-slate-100 text-slate-500 ring-1 ring-slate-200",   iconCls: "text-slate-400" },
};

export default function TaskList({ tasks }: { tasks: ReportTask[] }) {
  if (tasks.length === 0) {
    return <p className="text-slate-500 text-sm py-4 text-center">ไม่มีรายการงาน</p>;
  }

  const grouped = tasks.reduce<Record<string, ReportTask[]>>((acc, task) => {
    if (!acc[task.category]) acc[task.category] = [];
    acc[task.category].push(task);
    return acc;
  }, {});

  const orderedCategories = (Object.keys(categoryConfig) as TaskCategory[]).filter(
    (cat) => grouped[cat]?.length
  );

  return (
    <div className="space-y-5">
      {orderedCategories.map((cat) => {
        const conf = categoryConfig[cat];
        const catTasks = grouped[cat];
        return (
          <div key={cat}>
            {/* Category header */}
            <div className="flex items-center gap-2 mb-2.5">
              <span className={`text-xs ${conf.iconCls}`} aria-hidden="true">{conf.icon}</span>
              <span className={`text-xs font-semibold px-2.5 py-0.5 rounded-full ${conf.badgeCls}`}>
                {conf.label}
              </span>
              <span className="text-xs text-slate-500 ml-auto">{catTasks.length} รายการ</span>
            </div>

            {/* Tasks */}
            <ul className="space-y-1.5">
              {catTasks.map((task) => (
                <li
                  key={task.id}
                  className="flex items-start gap-3 px-4 py-3 rounded-lg bg-slate-50 hover:bg-slate-100 transition-colors"
                >
                  <FaCircleCheck className="text-emerald-500 text-sm mt-0.5 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-slate-700">{task.title}</p>
                    {task.description && (
                      <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">{task.description}</p>
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
