"use client";
import { Button } from "@/components/ui/button";
export default function ErrorPage({ reset }: { reset: () => void }) {
  return <div role="alert" className="space-y-3 rounded-xl border p-6"><h2 className="font-semibold">Unable to load Dev Tools</h2><p className="text-sm text-muted-foreground">Please retry. Your existing borrower records are retained.</p><Button onClick={reset} variant="outline">Retry</Button></div>;
}
