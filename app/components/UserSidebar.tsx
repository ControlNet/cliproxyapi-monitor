"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { LayoutDashboard, LogOut, Table } from "lucide-react";
import { useState } from "react";

const links = [
  { href: "/user", label: "用户仪表盘", icon: LayoutDashboard },
  { href: "/user/records", label: "我的记录", icon: Table }
];

function isActiveLink(pathname: string, href: string) {
  if (href === "/user") {
    return pathname === href;
  }

  return pathname === href || pathname.startsWith(`${href}/`);
}

export default function UserSidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const [loggingOut, setLoggingOut] = useState(false);

  const handleLogout = async () => {
    setLoggingOut(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
      router.push("/login");
      router.refresh();
    } catch {
      setLoggingOut(false);
    }
  };

  return (
    <aside className="fixed left-0 top-0 z-40 flex h-screen w-56 flex-col border-r border-slate-800 bg-slate-950 py-6">
      <div className="px-5">
        <h1 className="text-xl font-bold text-white">CLIProxyAPI</h1>
        <p className="text-sm text-slate-500">User Dashboard</p>
      </div>

      <nav className="mt-8 flex-1 space-y-1 px-3">
        {links.map(({ href, label, icon: Icon }) => {
          const active = isActiveLink(pathname, href);

          return (
            <Link
              key={href}
              href={href}
              className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-base font-medium transition-colors ${
                active
                  ? "bg-indigo-600 text-white"
                  : "text-slate-400 hover:bg-slate-800 hover:text-white"
              }`}
            >
              <Icon className="h-5 w-5" />
              {label}
            </Link>
          );
        })}
      </nav>

      <div className="mt-auto border-t border-slate-800 px-4 pb-2 pt-4">
        <button
          type="button"
          onClick={handleLogout}
          disabled={loggingOut}
          className="flex w-full items-center justify-center gap-2 rounded-lg border border-slate-700 px-3 py-2 text-sm font-medium text-slate-300 transition hover:bg-slate-800 hover:text-white disabled:opacity-50"
        >
          <LogOut className="h-4 w-4" />
          {loggingOut ? "退出中..." : "退出登录"}
        </button>
      </div>
    </aside>
  );
}
