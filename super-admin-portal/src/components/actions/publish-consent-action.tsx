"use client";

import { Send } from "lucide-react";
import { useRouter } from "next/navigation";
import type { FormEvent } from "react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

export function PublishConsentAction({ consentId }: { consentId: string }) {
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!reason.trim()) return;

    setIsSubmitting(true);
    const response = await fetch(`/api/admin/consent-versions/${consentId}/publish`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason })
    });
    setIsSubmitting(false);

    if (!response.ok) {
      const result = (await response.json()) as { error?: string };
      toast.error(result.error || "Unable to publish consent version");
      return;
    }

    toast.success("Consent version published");
    setReason("");
    router.refresh();
  }

  return (
    <form className="space-y-3" onSubmit={onSubmit}>
      <Textarea value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Publish reason" />
      <Button type="submit" disabled={isSubmitting}>
        <Send className="h-4 w-4" aria-hidden="true" />
        Publish
      </Button>
    </form>
  );
}
