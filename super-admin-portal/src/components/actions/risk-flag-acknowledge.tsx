"use client";

import { CheckCircle2 } from "lucide-react";
import { useRouter } from "next/navigation";
import type { FormEvent } from "react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function RiskFlagAcknowledge() {
  const router = useRouter();
  const [flagId, setFlagId] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!flagId.trim()) return;

    setIsSubmitting(true);
    const response = await fetch(`/api/admin/risk-flags/${flagId.trim()}/acknowledge`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({})
    });
    setIsSubmitting(false);

    if (!response.ok) {
      const result = (await response.json()) as { error?: string };
      toast.error(result.error || "Unable to acknowledge risk flag");
      return;
    }

    toast.success("Risk flag acknowledged");
    setFlagId("");
    router.refresh();
  }

  return (
    <form className="flex w-full flex-col gap-2 sm:max-w-md sm:flex-row" onSubmit={onSubmit}>
      <Input value={flagId} onChange={(event) => setFlagId(event.target.value)} placeholder="Risk flag ID" />
      <Button type="submit" disabled={isSubmitting}>
        <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
        Acknowledge
      </Button>
    </form>
  );
}
