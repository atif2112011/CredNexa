"use client";

import { Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";

export function DeleteConsentAction({ consentId, returnPath }: { consentId: string; returnPath: string }) {
  const router = useRouter();
  const [isDeleting, setIsDeleting] = useState(false);

  async function onDelete() {
    if (!window.confirm("Delete this unpublished consent draft? This cannot be undone.")) return;
    setIsDeleting(true);
    try {
      const response = await fetch(`/api/admin/consent-versions/${consentId}`, { method: "DELETE" });
      if (!response.ok) {
        const result = (await response.json().catch(() => null)) as { error?: string } | null;
        toast.error(result?.error || "Unable to delete consent draft");
        return;
      }
      toast.success("Consent draft deleted");
      router.push(returnPath);
      router.refresh();
    } catch {
      toast.error("Unable to reach the server");
    } finally {
      setIsDeleting(false);
    }
  }

  return (
    <Button type="button" variant="destructive" disabled={isDeleting} onClick={onDelete}>
      <Trash2 className="h-4 w-4" aria-hidden="true" />
      Delete draft
    </Button>
  );
}
