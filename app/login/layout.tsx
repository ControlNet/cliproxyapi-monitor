import type { Metadata } from "next";
import "../globals.css";

export const metadata: Metadata = {
  title: "登录 - CLIProxyAPI Dashboard",
  description: "Login to CLIProxyAPI Usage Dashboard"
};

export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
