"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Copy, Save } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export type FieldConfig = {
  name: string;
  label: string;
  type?: "text" | "email" | "password" | "number" | "textarea" | "select";
  required?: boolean;
  options?: { label: string; value: string; parentValue?: string }[];
  placeholder?: string;
  helpText?: string;
};

type FormDialogProps = {
  title: string;
  description?: string;
  triggerLabel: string;
  endpoint: string;
  method?: "POST" | "PATCH";
  fields: FieldConfig[];
  defaultValues?: Record<string, unknown>;
  variant?: "default" | "outline" | "secondary" | "destructive";
  payloadMode?: "default" | "account";
  successVariant?: "partner" | "tenant";
};

type ApiEnvelope = {
  success?: boolean;
  error?: string;
  data?: Record<string, unknown>;
};

function buildPartnerOrTenantPayload(values: Record<string, string | undefined>) {
  const payload = Object.fromEntries(
    Object.entries(values)
      .filter(([, value]) => String(value ?? "").trim() !== "")
      .map(([key, value]) => [key, String(value ?? "")])
  ) as Record<string, unknown>;

  payload.address = {
    street: values.addressStreet || "",
    city: values.addressCity || "",
    district: values.addressDistrict || "",
    state: values.addressState || "",
    pincode: values.addressPincode || ""
  };

  delete payload.addressStreet;
  delete payload.addressCity;
  delete payload.addressDistrict;
  delete payload.addressState;
  delete payload.addressPincode;

  if (values.pincodeRestrictionEnabled !== undefined) {
    payload.pincodeRestrictionEnabled = values.pincodeRestrictionEnabled === "true";
  }
  if (values.tenantOnboardingLimit !== undefined && values.tenantOnboardingLimit !== "") {
    payload.tenantOnboardingLimit = Number(values.tenantOnboardingLimit);
  }

  return payload;
}

function prepareAccountPayload(values: Record<string, string | undefined>) {
  const payload: Record<string, unknown> = {
    name: values.name || "",
    email: values.email || "",
    mobile: values.mobile || "",
    role: values.role || "",
    temporaryPassword: values.temporaryPassword || ""
  };

  if (values.role === "partner_admin") {
    if (values.channelPartnerId && values.channelPartnerId !== "none") {
      payload.channelPartnerId = values.channelPartnerId;
    }
    return payload;
  }

  if (values.role === "tenant_admin") {
    if (values.tenantId && values.tenantId !== "none") {
      payload.tenantId = values.tenantId;
    }
    if (values.channelPartnerId && values.channelPartnerId !== "none") {
      payload.channelPartnerId = values.channelPartnerId;
    }
  }

  return payload;
}

function buildSchema(fields: FieldConfig[]) {
  return z.object(
    Object.fromEntries(
      fields.map((field) => [
        field.name,
        field.required ? z.string().min(1, `${field.label} is required`) : z.string().optional()
      ])
    )
  );
}

export function FormDialog({
  title,
  description,
  triggerLabel,
  endpoint,
  method = "POST",
  fields,
  defaultValues,
  variant = "default",
  payloadMode = "default",
  successVariant
}: FormDialogProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [creationResult, setCreationResult] = useState<Record<string, unknown> | null>(null);
  const schema = buildSchema(fields);
  const form = useForm<Record<string, string | undefined>>({
    resolver: zodResolver(schema),
    defaultValues: Object.fromEntries(fields.map((field) => [field.name, String(defaultValues?.[field.name] ?? "")]))
  });
  const role = form.watch("role");
  const selectedPartnerId = form.watch("channelPartnerId");
  const visibleFields = fields.filter((field) => {
    if (field.name === "tenantId" && role === "partner_admin") return false;
    return true;
  });

  async function onSubmit(values: Record<string, string | undefined>) {
    if (values.role === "partner_admin" && (!values.channelPartnerId || values.channelPartnerId === "none")) {
      toast.error("Channel partner is required for partner admin");
      return;
    }

    if (
      values.role === "tenant_admin" &&
      ((!values.tenantId || values.tenantId === "none") ||
        (!values.channelPartnerId || values.channelPartnerId === "none"))
    ) {
      toast.error("Channel partner and tenant are required for tenant admin");
      return;
    }

    setIsSubmitting(true);
    const normalizedPayload = Object.fromEntries(
      Object.entries(values).map(([key, value]) => {
        const field = fields.find((item) => item.name === key);
        const normalizedValue = String(value ?? "");
        if (field?.type === "number") return [key, Number(normalizedValue)];
        if (key === "isActive" || key === "pincodeRestrictionEnabled") return [key, value === "true"];
        return [key, normalizedValue];
      })
    );
    const payload =
      payloadMode === "account"
        ? prepareAccountPayload(values)
        : fields.some((field) => field.name.startsWith("address"))
          ? buildPartnerOrTenantPayload(values)
          : normalizedPayload;

    const response = await fetch(endpoint, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const result = (await response.json().catch(() => null)) as ApiEnvelope | null;
    setIsSubmitting(false);

    if (!response.ok) {
      toast.error(result?.error || "Action failed");
      return;
    }

    if (successVariant && result?.data) {
      setCreationResult(result.data);
      toast.success("Created successfully");
      return;
    }

    toast.success("Saved successfully");
    setOpen(false);
    router.refresh();
  }

  function handleOpenChange(nextOpen: boolean) {
    setOpen(nextOpen);
    if (!nextOpen) {
      const shouldRefresh = Boolean(creationResult);
      setCreationResult(null);
      form.reset();
      if (shouldRefresh) router.refresh();
    }
  }

  async function copyValue(value: unknown, label: string) {
    await navigator.clipboard.writeText(String(value || ""));
    toast.success(`${label} copied`);
  }

  const organization = creationResult
    ? (creationResult[successVariant === "partner" ? "channelPartner" : "tenant"] as Record<string, unknown> | undefined)
    : undefined;
  const adminAccount = creationResult
    ? (creationResult[successVariant === "partner" ? "partnerAdmin" : "tenantAdmin"] as Record<string, unknown> | undefined)
    : undefined;
  const credentials = creationResult?.credentials as Record<string, unknown> | undefined;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button variant={variant}>{triggerLabel}</Button>
      </DialogTrigger>
      <DialogContent className="flex max-h-[90vh] flex-col sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description ? <DialogDescription>{description}</DialogDescription> : null}
        </DialogHeader>
        {creationResult ? (
          <div className="flex min-h-0 flex-1 flex-col gap-4">
            <div className="space-y-4 overflow-y-auto pr-1">
              <div className="rounded-lg border bg-muted/20 p-4">
                <p className="text-sm font-medium text-muted-foreground">Created {successVariant === "partner" ? "partner" : "tenant"}</p>
                <p className="mt-1 text-base font-semibold">{String(organization?.name || "-")}</p>
              </div>
              <div className="space-y-3 rounded-lg border p-4">
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Admin account</p>
                  <p className="font-semibold">{String(adminAccount?.name || "-")}</p>
                </div>
                {[
                  ["Mobile", credentials?.mobile],
                  ["Email", credentials?.email],
                  ["Password", credentials?.temporaryPassword]
                ].map(([label, value]) => (
                  <div key={String(label)} className="flex items-center justify-between gap-3 border-t pt-3">
                    <div className="min-w-0">
                      <p className="text-xs font-medium text-muted-foreground">{String(label)}</p>
                      <p className="break-all text-sm font-medium">{String(value || "-")}</p>
                    </div>
                    {value ? (
                      <Button type="button" variant="ghost" size="icon" title={`Copy ${String(label).toLowerCase()}`} onClick={() => copyValue(value, String(label))}>
                        <Copy className="h-4 w-4" aria-hidden="true" />
                        <span className="sr-only">Copy {String(label).toLowerCase()}</span>
                      </Button>
                    ) : null}
                  </div>
                ))}
              </div>
              <p className="text-sm text-muted-foreground">This password is shown only once. Store it before closing.</p>
            </div>
            <div className="flex justify-end border-t pt-4">
              <Button type="button" onClick={() => handleOpenChange(false)}>Done</Button>
            </div>
          </div>
        ) : (
        <form className="flex min-h-0 flex-1 flex-col gap-4" onSubmit={form.handleSubmit(onSubmit)}>
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
            {visibleFields.map((field) => (
              <div key={field.name} className="flex flex-col gap-2">
                <Label htmlFor={field.name}>{field.label}</Label>
                {field.type === "textarea" ? (
                  <Textarea id={field.name} placeholder={field.placeholder} {...form.register(field.name)} />
                ) : field.type === "select" ? (
                  <select
                    id={field.name}
                    className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
                    disabled={payloadMode === "account" && field.name === "tenantId" && role === "tenant_admin" && (!selectedPartnerId || selectedPartnerId === "none")}
                    {...form.register(field.name)}
                  >
                    <option value="">Select</option>
                    {field.options
                      ?.filter((option) => field.name !== "tenantId" || !option.parentValue || option.parentValue === selectedPartnerId)
                      .map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                ) : (
                  <Input id={field.name} type={field.type || "text"} placeholder={field.placeholder} {...form.register(field.name)} />
                )}
                {form.formState.errors[field.name] ? (
                  <p className="text-sm text-destructive">{String(form.formState.errors[field.name]?.message)}</p>
                ) : null}
                {field.helpText ? <p className="text-xs text-muted-foreground">{field.helpText}</p> : null}
              </div>
            ))}
          </div>
          <div className="flex justify-end border-t pt-4">
            <Button type="submit" disabled={isSubmitting}>
              <Save className="h-4 w-4" aria-hidden="true" />
              {isSubmitting ? "Saving..." : "Save"}
            </Button>
          </div>
        </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
