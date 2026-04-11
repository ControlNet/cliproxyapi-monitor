import type { ReactNode } from "react";
import UserSidebar from "@/app/components/UserSidebar";

export default function UserLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <UserSidebar />
      <div className="ml-56 min-h-screen bg-slate-950">{children}</div>
    </>
  );
}
