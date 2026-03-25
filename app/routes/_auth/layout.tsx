import { Outlet } from "react-router";

export default function AuthLayout() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-900 to-violet-950 flex items-center justify-center p-4">
      <Outlet />
    </div>
  );
}
