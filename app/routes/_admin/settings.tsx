import { requireAdmin } from "~/lib/auth.server";

export function meta() {
  return [{ title: "Admin Settings — DoAction Portal" }];
}

export async function loader({ request, context }: any) {
  await requireAdmin(request, context.cloudflare.env.DB, context.cloudflare.env.SESSIONPORTAL);
  return null;
}

export default function AdminSettingsPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold text-slate-900">Settings</h1>
      <div className="rounded-xl border border-slate-200 bg-white p-5 text-sm text-slate-600">
        Admin settings panel scaffold is ready. Add configuration modules here.
      </div>
    </div>
  );
}
