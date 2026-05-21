"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  AlertTriangle,
  Building2,
  FileClock,
  Gauge,
  KeyRound,
  Landmark,
  LogOut,
  ScrollText,
  ShieldAlert,
  Smartphone,
  Users
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const navItems = [
  { href: "/dashboard", label: "Dashboard", icon: Gauge },
  { href: "/partners", label: "Partners", icon: Landmark },
  { href: "/tenants", label: "Tenants", icon: Building2 },
  { href: "/accounts", label: "Accounts", icon: Users },
  { href: "/consent-versions", label: "Consent", icon: ScrollText },
  { href: "/escalations", label: "Escalations", icon: ShieldAlert },
  { href: "/devices", label: "Devices", icon: Smartphone },
  { href: "/risk-flags", label: "Risk Flags", icon: AlertTriangle },
  { href: "/audit-logs", label: "Audit Logs", icon: FileClock }
];

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();

  async function logout() {
    await fetch("/api/session/logout", { method: "POST" });
    router.push("/login");
  }

  return (
    <aside className="sticky top-0 flex h-screen w-full flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground">
      <div className="flex h-20 items-center gap-3 border-b px-5">
        <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-sm">
          <KeyRound className="h-5 w-5" aria-hidden="true" />
        </div>
        <div>
          <p className="text-base font-semibold tracking-tight text-white">CredNexa</p>
          <p className="text-xs font-medium text-white/60">Super Admin Console</p>
        </div>
      </div>
      <nav className="flex-1 space-y-1.5 p-3" aria-label="Main navigation">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-white/65 transition-colors hover:bg-white/8 hover:text-white",
                isActive && "bg-white/10 text-white shadow-sm ring-1 ring-white/10"
              )}
            >
              <span
                className={cn(
                  "flex h-7 w-7 items-center justify-center rounded-lg bg-white/7 text-white/60 ring-1 ring-white/10 transition-colors group-hover:text-white",
                  isActive && "bg-primary text-primary-foreground ring-primary"
                )}
              >
                <Icon className="h-4 w-4" aria-hidden="true" />
              </span>
              {item.label}
            </Link>
          );
        })}
      </nav>
      <div className="border-t border-white/10 p-3 pb-5">
        <Button type="button" variant="ghost" className="h-10 w-full justify-start rounded-xl text-white/80 hover:bg-white/8 hover:text-white" onClick={logout}>
          <LogOut className="h-4 w-4" aria-hidden="true" />
          Sign out
        </Button>
      </div>
    </aside>
  );
}
