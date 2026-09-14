import { Outlet } from "react-router";

export default function AuthLayout() {
  return (
    <div className="min-h-screen relative overflow-hidden flex items-center justify-center p-4" style={{ backgroundColor: '#1e3a5f' }}>
      {/* Animated background mesh gradient */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        {/* Base gradient overlay */}
        <div className="absolute inset-0" style={{ background: 'linear-gradient(135deg, #1e3a5f 0%, #2d4f7c 50%, #1e3a5f 100%)' }} />
        
        {/* Animated gradient orbs */}
        <div className="absolute -top-40 -left-40 w-[500px] h-[500px] rounded-full bg-blue-500/20 blur-[120px] animate-float-slow" />
        <div className="absolute top-1/3 -right-32 w-[450px] h-[450px] rounded-full bg-violet-500/15 blur-[100px] animate-float-slow-reverse" style={{ animationDelay: '-8s' }} />
        <div className="absolute bottom-20 -left-24 w-[380px] h-[380px] rounded-full bg-cyan-500/12 blur-[90px] animate-float-slow" style={{ animationDelay: '-16s' }} />
        <div className="absolute -bottom-32 right-1/4 w-[350px] h-[350px] rounded-full bg-indigo-500/10 blur-[80px] animate-float-slow-reverse" style={{ animationDelay: '-24s' }} />
        
        {/* Subtle accent orbs */}
        <div className="absolute top-20 left-1/4 w-32 h-32 rounded-full bg-brand-yellow/10 blur-[60px] animate-pulse" style={{ animationDuration: '8s' }} />
        <div className="absolute bottom-1/3 right-1/3 w-24 h-24 rounded-full bg-brand-blue/8 blur-[50px] animate-pulse" style={{ animationDuration: '10s', animationDelay: '-3s' }} />
        
        {/* Geometric floating shapes */}
        <div className="absolute top-1/4 left-1/6 w-2 h-2 rounded-full bg-white/20 animate-float-slow" style={{ animationDelay: '-5s' }} />
        <div className="absolute top-1/2 right-1/5 w-1.5 h-1.5 rounded-full bg-white/15 animate-float-slow-reverse" style={{ animationDelay: '-12s' }} />
        <div className="absolute bottom-1/4 left-1/3 w-1 h-1 rounded-full bg-white/25 animate-float-slow" style={{ animationDelay: '-18s' }} />
        <div className="absolute top-3/4 right-1/4 w-1.5 h-1.5 rounded-full bg-white/10 animate-float-slow-reverse" style={{ animationDelay: '-22s' }} />
      </div>
      
      {/* Subtle grid pattern overlay */}
      <div className="absolute inset-0 pointer-events-none opacity-[0.03]">
        <div className="absolute inset-0" style={{
          backgroundImage: 'radial-gradient(circle at 1px 1px, white 1px, transparent 0)',
          backgroundSize: '40px 40px'
        }} />
      </div>
      
      {/* Content */}
      <div className="w-full flex items-center justify-center relative z-10">
        <Outlet />
      </div>
    </div>
  );
}
