import { LoginForm } from "./login-form";
import { KeyRound, ShieldCheck, Users } from "lucide-react";

export default function LoginPage() {
  return (
    <main className="grid min-h-screen bg-muted/40 lg:grid-cols-[1fr_480px]">
      <section className="hidden border-r bg-background p-10 lg:flex lg:flex-col lg:justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-sm">
            <KeyRound className="h-5 w-5" aria-hidden="true" />
          </div>
          <div>
            <p className="text-base font-semibold">CredNexa</p>
            <p className="text-xs text-muted-foreground">Super Admin Console</p>
          </div>
        </div>
        <div className="max-w-xl">
          <p className="text-sm font-medium text-primary">Platform Operations</p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight">Control partners, tenants, devices, and escalations from one focused workspace.</h1>
          <div className="mt-8 grid gap-3 md:grid-cols-2">
            <div className="rounded-2xl border bg-muted/30 p-4">
              <ShieldCheck className="h-5 w-5 text-primary" aria-hidden="true" />
              <p className="mt-3 text-sm font-semibold">Override Governance</p>
              <p className="mt-1 text-sm text-muted-foreground">Mandatory-reason unlock decisions and audit trails.</p>
            </div>
            <div className="rounded-2xl border bg-muted/30 p-4">
              <Users className="h-5 w-5 text-primary" aria-hidden="true" />
              <p className="mt-3 text-sm font-semibold">Admin Control</p>
              <p className="mt-1 text-sm text-muted-foreground">Partner and tenant admin scope management.</p>
            </div>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">CredNexa EMI Shield</p>
      </section>
      <section className="flex min-h-screen items-center justify-center px-4 py-10">
        <div className="w-full max-w-md">
          <div className="mb-8 lg:hidden">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-sm">
              <KeyRound className="h-5 w-5" aria-hidden="true" />
            </div>
            <h1 className="mt-4 text-3xl font-semibold tracking-tight">Super Admin Portal</h1>
            <p className="mt-2 text-sm text-muted-foreground">Sign in with a super admin account.</p>
          </div>
        <LoginForm />
      </div>
      </section>
    </main>
  );
}
