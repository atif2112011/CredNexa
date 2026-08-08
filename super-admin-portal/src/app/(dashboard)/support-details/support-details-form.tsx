"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { AtSign, MessageCircle, Phone, Save } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { RecordItem } from "@/types/api";

const phonePattern = /^\+?[0-9][0-9\s().-]{6,19}$/;

const optionalPhone = (label: string) =>
  z
    .string()
    .trim()
    .refine((value) => !value || phonePattern.test(value), `${label} must be a valid phone number`);

const supportDetailsSchema = z.object({
  supportEmail: z.string().trim().toLowerCase().email("Enter a valid email address").or(z.literal("")),
  supportPhone: optionalPhone("Support phone"),
  supportWhatsapp: optionalPhone("Support WhatsApp")
});

type SupportDetailsFormValues = z.infer<typeof supportDetailsSchema>;

type SupportDetailsFormProps = {
  supportDetails: RecordItem;
};

const getStringValue = (record: RecordItem, key: keyof SupportDetailsFormValues) => String(record[key] ?? "");

const getApiError = async (response: Response) => {
  try {
    const payload = (await response.json()) as { error?: string };
    return payload.error || "Unable to save support details";
  } catch {
    return "Unable to save support details";
  }
};

const fields: Array<{
  name: keyof SupportDetailsFormValues;
  label: string;
  type: string;
  placeholder: string;
  icon: typeof AtSign;
}> = [
  {
    name: "supportEmail",
    label: "Support email",
    type: "email",
    placeholder: "support@example.com",
    icon: AtSign
  },
  {
    name: "supportPhone",
    label: "Support phone",
    type: "tel",
    placeholder: "+911234567890",
    icon: Phone
  },
  {
    name: "supportWhatsapp",
    label: "Support WhatsApp",
    type: "tel",
    placeholder: "+911234567890",
    icon: MessageCircle
  }
];

export function SupportDetailsForm({ supportDetails }: SupportDetailsFormProps) {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);

  const form = useForm<SupportDetailsFormValues>({
    resolver: zodResolver(supportDetailsSchema),
    defaultValues: {
      supportEmail: getStringValue(supportDetails, "supportEmail"),
      supportPhone: getStringValue(supportDetails, "supportPhone"),
      supportWhatsapp: getStringValue(supportDetails, "supportWhatsapp")
    }
  });

  async function onSubmit(values: SupportDetailsFormValues) {
    setIsSubmitting(true);
    try {
      const response = await fetch("/api/admin/support-contact", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values)
      });

      if (!response.ok) throw new Error(await getApiError(response));

      toast.success("Support details saved");
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to save support details");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
      <Card className="rounded-lg">
        <CardHeader>
          <CardTitle>Contact Details</CardTitle>
          <CardDescription>Update the support channels available to customers in the app.</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="space-y-6" onSubmit={form.handleSubmit(onSubmit)}>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {fields.map((field) => {
                const Icon = field.icon;
                return (
                  <div key={field.name} className="flex flex-col gap-2">
                    <Label htmlFor={field.name}>{field.label}</Label>
                    <div className="relative">
                      <Icon className="pointer-events-none absolute left-2.5 top-2 h-4 w-4 text-muted-foreground" aria-hidden="true" />
                      <Input
                        id={field.name}
                        type={field.type}
                        placeholder={field.placeholder}
                        className="pl-8"
                        aria-invalid={Boolean(form.formState.errors[field.name])}
                        {...form.register(field.name)}
                      />
                    </div>
                    {form.formState.errors[field.name] ? (
                      <p className="text-sm text-destructive">{form.formState.errors[field.name]?.message}</p>
                    ) : null}
                  </div>
                );
              })}
            </div>

            <div className="flex justify-end border-t pt-4">
              <Button type="submit" disabled={isSubmitting}>
                <Save className="h-4 w-4" aria-hidden="true" />
                {isSubmitting ? "Saving..." : "Save"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card className="rounded-lg">
        <CardHeader>
          <CardTitle>Current App Payload</CardTitle>
          <CardDescription>Returned by the borrower app support endpoint.</CardDescription>
        </CardHeader>
        <CardContent>
          <dl className="space-y-4 text-sm">
            <div>
              <dt className="font-medium text-foreground">Email</dt>
              <dd className="mt-1 break-all text-muted-foreground">{form.watch("supportEmail") || "-"}</dd>
            </div>
            <div>
              <dt className="font-medium text-foreground">Phone</dt>
              <dd className="mt-1 break-all text-muted-foreground">{form.watch("supportPhone") || "-"}</dd>
            </div>
            <div>
              <dt className="font-medium text-foreground">WhatsApp</dt>
              <dd className="mt-1 break-all text-muted-foreground">{form.watch("supportWhatsapp") || "-"}</dd>
            </div>
          </dl>
        </CardContent>
      </Card>
    </div>
  );
}
