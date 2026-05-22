import { Outlet } from "react-router";

export default function AuthLayout() {
  return (
    <div className="min-h-screen bg-[#eeeeee] flex items-center justify-center p-4">
      <div className="w-full flex items-center justify-center">
        <Outlet />
      </div>
    </div>
  );
}
