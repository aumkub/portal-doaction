import { useEffect, useState } from "react";
import { useFetcher } from "react-router";
import type { IconType } from "react-icons";
import {
  FaArrowsRotate,
  FaBell,
  FaCloud,
  FaDatabase,
  FaEnvelope,
  FaHardDrive,
  FaHeartPulse,
  FaKey,
  FaPaperclip,
  FaTelegram,
} from "react-icons/fa6";

type Status = "ok" | "warn" | "fail";
interface Result {
  id: string;
  status: Status;
  detail: string;
  ms: number;
}

const CHECKS: { id: string; label: string; hint: string; icon: IconType }[] = [
  { id: "d1", label: "ฐานข้อมูล (D1)", hint: "ข้อมูลลูกค้า ticket รายงาน", icon: FaDatabase },
  { id: "kv", label: "Session (KV)", hint: "การเข้าสู่ระบบ", icon: FaKey },
  { id: "r2", label: "ไฟล์แนบ (R2)", hint: "ไฟล์ใน ticket", icon: FaPaperclip },
  { id: "email", label: "ส่งอีเมล", hint: "Cloudflare Email", icon: FaEnvelope },
  { id: "session_secret", label: "Session Secret", hint: "ลิงก์รายงานให้ลูกค้า", icon: FaKey },
  { id: "uptimerobot", label: "UptimeRobot", hint: "สถานะเว็บลูกค้า", icon: FaHeartPulse },
  { id: "telegram", label: "Telegram", hint: "แจ้งเตือนทีม", icon: FaTelegram },
  { id: "webdav", label: "Backup (WebDAV)", hint: "ไฟล์สำรองเว็บลูกค้า", icon: FaCloud },
];

const TONE: Record<Status, { dot: string; pill: string; label: string }> = {
  ok: { dot: "bg-emerald-500", pill: "bg-emerald-50 text-emerald-700", label: "ปกติ" },
  warn: { dot: "bg-brand-yellow", pill: "bg-[#FFF6C2] text-[#6B5B00]", label: "ควรตรวจ" },
  fail: { dot: "bg-[#E0622A]", pill: "bg-[#FDE7DA] text-[#B4541A]", label: "ใช้งานไม่ได้" },
};

/** One row per connection; each can be checked alone or all at once. */
export function HealthPanel() {
  const all = useFetcher<{ results: Result[] }>();
  const one = useFetcher<{ results: Result[] }>();
  const [results, setResults] = useState<Record<string, Result>>({});
  const [busy, setBusy] = useState<string | null>(null);

  // Merge whichever fetcher just returned into the table.
  useEffect(() => {
    for (const f of [all, one]) {
      if (f.state === "idle" && f.data?.results) {
        setResults((prev) => ({ ...prev, ...Object.fromEntries(f.data!.results.map((r) => [r.id, r])) }));
      }
    }
    if (all.state === "idle" && one.state === "idle") setBusy(null);
  }, [all.state, all.data, one.state, one.data]);

  function run(id: string) {
    setBusy(id);
    (id === "all" ? all : one).submit({ check: id }, { method: "post", action: "/api/admin/health" });
  }

  const checked = Object.values(results);
  const failing = checked.filter((r) => r.status === "fail").length;
  const warning = checked.filter((r) => r.status === "warn").length;

  return (
    <section className="overflow-hidden rounded-[20px] border border-line bg-white">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line-soft px-5 py-4">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-[16px] font-semibold text-ink">
            <FaHardDrive className="text-ink-soft" aria-hidden="true" />
            ตรวจสอบการเชื่อมต่อ
          </h2>
          <p className="mt-0.5 text-sm text-muted-ink">
            {checked.length === 0
              ? "กดตรวจเพื่อดูว่าทุกบริการยังทำงานปกติ (อ่านอย่างเดียว ไม่ส่งข้อความหาใคร)"
              : failing > 0
                ? `ใช้งานไม่ได้ ${failing} รายการ${warning ? ` · ควรตรวจ ${warning}` : ""}`
                : warning > 0
                  ? `ทำงานได้ · ควรตรวจ ${warning} รายการ`
                  : `ทุกบริการทำงานปกติ (${checked.length} รายการ)`}
          </p>
        </div>
        <button
          type="button"
          onClick={() => run("all")}
          disabled={busy !== null}
          className="inline-flex h-10 items-center gap-2 rounded-full bg-ink px-5 text-[13px] font-semibold text-white hover:bg-black disabled:opacity-60"
        >
          <FaArrowsRotate className={`text-xs ${busy === "all" ? "animate-spin" : ""}`} aria-hidden="true" />
          ตรวจทั้งหมด
        </button>
      </div>

      <ul className="divide-y divide-[#F4F2EC]">
        {CHECKS.map((c) => {
          const r = results[c.id];
          const tone = r ? TONE[r.status] : null;
          const running = busy === c.id || busy === "all";
          return (
            <li key={c.id} className="flex items-center gap-3.5 px-5 py-3.5">
              <span className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-[12px] bg-paper text-ink-soft">
                <c.icon className="text-sm" aria-hidden="true" />
                {tone && <span className={`absolute -right-0.5 -top-0.5 h-3 w-3 rounded-full ring-2 ring-white ${tone.dot}`} />}
              </span>
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-ink">
                  {c.label}
                  {tone && (
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${tone.pill}`}>{tone.label}</span>
                  )}
                </p>
                <p className="mt-0.5 text-xs text-muted-ink [overflow-wrap:anywhere]">
                  {running ? "กำลังตรวจ…" : r ? `${r.detail} · ${r.ms} ms` : c.hint}
                </p>
              </div>
              <button
                type="button"
                onClick={() => run(c.id)}
                disabled={busy !== null}
                aria-label={`ตรวจ ${c.label}`}
                className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border border-line bg-white px-3.5 text-xs font-semibold text-ink-soft hover:bg-paper disabled:opacity-50"
              >
                <FaArrowsRotate className={`text-[10px] ${running ? "animate-spin" : ""}`} aria-hidden="true" />
                ตรวจ
              </button>
            </li>
          );
        })}
      </ul>
      <p className="flex items-center gap-1.5 border-t border-line-soft px-5 py-3 text-xs text-faint-ink">
        <FaBell className="text-[10px]" aria-hidden="true" />
        การตรวจอีเมลดูจากการตั้งค่าและอีเมลฉบับล่าสุด จะไม่ส่งอีเมลทดสอบ
      </p>
    </section>
  );
}
