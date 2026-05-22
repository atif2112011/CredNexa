"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Save } from "lucide-react";
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
  options?: { label: string; value: string }[];
  placeholder?: string;
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
  preparePayload?: (values: Record<string, string | undefined>) => Record<string, unknown>;
};

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
  preparePayload
}: FormDialogProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const schema = buildSchema(fields);
  const form = useForm<Record<string, string | undefined>>({
    resolver: zodResolver(schema),
    defaultValues: Object.fromEntries(fields.map((field) => [field.name, String(defaultValues?.[field.name] ?? "")]))
  });
  const role = form.watch("role");
  const visibleFields = fields.filter((field) => {
    if (field.name === "tenantId" && role === "partner_admin") return false;
    return true;
  });

  async function onSubmit(values: Record<string, string | undefined>) {
    if (values.role === "partner_admin" && (!values.channelPartnerId || values.channelPartnerId === "none")) {
      toast.error("Channel partner is required for partner admin");
      return;
    }

    if (values.role === "tenant_admin" && (!values.tenantId || values.tenantId === "none")) {
      toast.error("Tenant is required for tenant admin");
      return;
    }

    setIsSubmitting(true);
    const normalizedPayload = Object.fromEntries(
      Object.entries(values).map(([key, value]) => {
        const field = fields.find((item) => item.name === key);
        const normalizedValue = String(value ?? "");
        if (field?.type === "number") return [key, Number(normalizedValue)];
        if (key === "capabilities") return [key, normalizedValue.split(",").map((item) => item.trim()).filter(Boolean)];
        if (key === "isActive") return [key, value === "true"];
        return [key, normalizedValue];
      })
    );
    const payload = preparePayload ? preparePayload(values) : normalizedPayload;

    const response = await fetch(endpoint, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    setIsSubmitting(false);

    if (!response.ok) {
      const result = (await response.json()) as { error?: string };
      toast.error(result.error || "Action failed");
      return;
    }

    toast.success("Saved successfully");
    setOpen(false);
    router.refresh();
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant={variant}>{triggerLabel}</Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description ? <DialogDescription>{description}</DialogDescription> : null}
        </DialogHeader>
        <form className="flex flex-col gap-4" onSubmit={form.handleSubmit(onSubmit)}>
          {visibleFields.map((field) => (
            <div key={field.name} className="flex flex-col gap-2">
              <Label htmlFor={field.name}>{field.label}</Label>
              {field.type === "textarea" ? (
                <Textarea id={field.name} placeholder={field.placeholder} {...form.register(field.name)} />
              ) : field.type === "select" ? (
                <select
                  id={field.name}
                  className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
                  {...form.register(field.name)}
                >
                  <option value="">Select</option>
                  {field.options?.map((option) => (
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
            </div>
          ))}
          <div className="flex justify-end border-t pt-4">
            <Button type="submit" disabled={isSubmitting}>
              <Save className="h-4 w-4" aria-hidden="true" />
              {isSubmitting ? "Saving..." : "Save"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
