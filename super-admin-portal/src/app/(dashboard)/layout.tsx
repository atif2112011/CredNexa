import { Sidebar } from "@/components/shell/sidebar";
import { KeyRound } from "lucide-react";
import type { ReactNode } from "react";

export default function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-background lg:grid lg:grid-cols-[280px_1fr]">
      <div className="hidden lg:block">
        <Sidebar />
      </div>
      <div className="min-w-0">
        <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b bg-background/90 px-4 backdrop-blur lg:hidden">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm">
            <KeyRound className="h-4 w-4" aria-hidden="true" />
          </div>
          <div>
            <p className="text-sm font-semibold">CredNexa</p>
            <p className="text-xs text-muted-foreground">Super Admin</p>
          </div>
        </header>
        <main className="mx-auto w-full max-w-[1560px] px-4 py-6 md:px-6 lg:px-10 lg:py-8">{children}</main>
      </div>
    </div>
  );
}
