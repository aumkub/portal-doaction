import { Outlet } from "react-router";

export default function AuthLayout() {
  return (
    <div className="relative min-h-screen overflow-hidden bg-paper text-ink">
      {/* Subtle yellow accent */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-brand-yellow opacity-90 md:h-96 md:w-96"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -bottom-32 -left-20 h-64 w-64 rounded-full border border-line"
      />
      <div className="relative z-10 flex min-h-screen flex-col items-center justify-center px-4 py-10">
        <img src="/logo-dark-tight.svg" alt="do action" className="mb-8 h-16 w-auto" />
        <Outlet />
        <p className="mt-6 text-center text-xs text-faint-ink">do action client portal</p>
      </div>
    </div>
  );
}
