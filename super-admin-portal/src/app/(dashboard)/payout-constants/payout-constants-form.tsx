"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Save, Upload } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { RecordItem } from "@/types/api";

const MAX_QR_IMAGE_BYTES = 5 * 1024 * 1024;
const ALLOWED_QR_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

const parseAmount = (value: string) => {
  if (!value.trim()) return null;
  const amount = Number(value);
  if (!Number.isFinite(amount)) return null;
  return Math.round((amount + Number.EPSILON) * 100) / 100;
};

const isNonNegativeAmount = (value: string) => {
  const amount = parseAmount(value);
  return amount !== null && amount >= 0;
};

const isNonNegativeInteger = (value: string) => {
  if (!value.trim()) return false;
  const number = Number(value);
  return Number.isInteger(number) && number >= 0;
};

const payoutConstantsSchema = z
  .object({
    defaultPartnerCreditPercentage: z.string().min(1, "Default partner credit percentage is required").refine((value) => {
      const number = Number(value);
      return Number.isFinite(number) && number >= 0 && number <= 100;
    }, "Enter a percentage from 0 to 100"),
    minPartnerPayoutAmount: z.string().min(1, "Minimum payout amount is required").refine(isNonNegativeAmount, "Enter a non-negative rupee amount"),
    maxPartnerPayoutAmount: z.string().min(1, "Maximum payout amount is required").refine(isNonNegativeAmount, "Enter a non-negative rupee amount"),
    defaultTenantCreditPerKeyPrice: z.string().min(1, "Credit price is required").refine(isNonNegativeAmount, "Enter a non-negative rupee amount"),
    minTenantCreditPurchase: z.string().min(1, "Minimum credit purchase is required").refine(isNonNegativeInteger, "Enter a non-negative whole number"),
    maxTenantCreditPurchase: z.string().min(1, "Maximum credit purchase is required").refine(isNonNegativeInteger, "Enter a non-negative whole number"),
    adminCreditPurchaseUpiId: z.string().min(1, "Admin UPI ID is required").regex(/^[A-Za-z0-9._-]+@[A-Za-z0-9.-]+$/, "Enter a valid UPI ID"),
    adminCreditPurchaseUpiName: z.string().min(1, "Admin UPI name is required")
  })
  .superRefine((values, ctx) => {
    const minPayout = parseAmount(values.minPartnerPayoutAmount) ?? 0;
    const maxPayout = parseAmount(values.maxPartnerPayoutAmount) ?? 0;
    if (maxPayout > 0 && maxPayout < minPayout) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["maxPartnerPayoutAmount"],
        message: "Maximum payout must be 0 or at least the minimum payout"
      });
    }

    const minCredits = Number(values.minTenantCreditPurchase);
    const maxCredits = Number(values.maxTenantCreditPurchase);
    if (maxCredits > 0 && maxCredits < minCredits) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["maxTenantCreditPurchase"],
        message: "Maximum credits must be 0 or at least the minimum credits"
      });
    }
  });

type PayoutConstantsFormValues = z.infer<typeof payoutConstantsSchema>;

type PayoutConstantsFormProps = {
  payoutConstants: RecordItem;
};

const fieldGroups: Array<{
  title: string;
  fields: Array<{
    name: keyof PayoutConstantsFormValues;
    label: string;
    type?: "text" | "number";
    step?: string;
  }>;
}> = [
  {
    title: "Partner Payout",
    fields: [
      { name: "defaultPartnerCreditPercentage", label: "Default partner credit %", type: "number", step: "0.01" },
      { name: "minPartnerPayoutAmount", label: "Minimum payout amount", type: "number", step: "0.01" },
      { name: "maxPartnerPayoutAmount", label: "Maximum payout amount", type: "number", step: "0.01" }
    ]
  },
  {
    title: "Tenant Credits",
    fields: [
      { name: "defaultTenantCreditPerKeyPrice", label: "Default credit price per key", type: "number", step: "0.01" },
      { name: "minTenantCreditPurchase", label: "Minimum credit purchase", type: "number", step: "1" },
      { name: "maxTenantCreditPurchase", label: "Maximum credit purchase", type: "number", step: "1" }
    ]
  },
  {
    title: "Admin Payment",
    fields: [
      { name: "adminCreditPurchaseUpiId", label: "Admin credit purchase UPI ID" },
      { name: "adminCreditPurchaseUpiName", label: "Admin credit purchase UPI name" }
    ]
  }
];

const asStringValue = (record: RecordItem, key: keyof PayoutConstantsFormValues) => String(record[key] ?? "");

const getApiError = async (response: Response) => {
  try {
    const payload = (await response.json()) as { error?: string };
    return payload.error || "Unable to save payout constants";
  } catch {
    return "Unable to save payout constants";
  }
};

const validateQrFile = (file: File) => {
  if (!ALLOWED_QR_IMAGE_TYPES.has(file.type)) return "QR image must be JPEG, PNG, or WebP";
  if (file.size > MAX_QR_IMAGE_BYTES) return "QR image must be 5 MB or smaller";
  return "";
};

export function PayoutConstantsForm({ payoutConstants }: PayoutConstantsFormProps) {
  const router = useRouter();
  const [qrFile, setQrFile] = useState<File | null>(null);
  const [qrError, setQrError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const selectedQrPreview = useMemo(() => (qrFile ? URL.createObjectURL(qrFile) : ""), [qrFile]);
  const currentQrUrl = String(payoutConstants.adminCreditPurchaseQrImageUrl || "");

  useEffect(() => {
    return () => {
      if (selectedQrPreview) URL.revokeObjectURL(selectedQrPreview);
    };
  }, [selectedQrPreview]);

  const form = useForm<PayoutConstantsFormValues>({
    resolver: zodResolver(payoutConstantsSchema),
    defaultValues: {
      defaultPartnerCreditPercentage: asStringValue(payoutConstants, "defaultPartnerCreditPercentage"),
      minPartnerPayoutAmount: asStringValue(payoutConstants, "minPartnerPayoutAmount"),
      maxPartnerPayoutAmount: asStringValue(payoutConstants, "maxPartnerPayoutAmount"),
      defaultTenantCreditPerKeyPrice: asStringValue(payoutConstants, "defaultTenantCreditPerKeyPrice"),
      minTenantCreditPurchase: asStringValue(payoutConstants, "minTenantCreditPurchase"),
      maxTenantCreditPurchase: asStringValue(payoutConstants, "maxTenantCreditPurchase"),
      adminCreditPurchaseUpiId: asStringValue(payoutConstants, "adminCreditPurchaseUpiId"),
      adminCreditPurchaseUpiName: asStringValue(payoutConstants, "adminCreditPurchaseUpiName")
    }
  });

  function onQrFileChange(fileList: FileList | null) {
    const file = fileList?.[0] || null;
    if (!file) {
      setQrFile(null);
      setQrError("");
      return;
    }

    const error = validateQrFile(file);
    setQrError(error);
    setQrFile(error ? null : file);
  }

  async function onSubmit(values: PayoutConstantsFormValues) {
    if (qrError) return;

    const body = new FormData();
    Object.entries(values).forEach(([key, value]) => {
      body.append(key, value);
    });
    if (qrFile) body.append("adminCreditPurchaseQrImage", qrFile);

    setIsSubmitting(true);
    try {
      const response = await fetch("/api/admin/payout/constants", {
        method: "PATCH",
        body
      });

      if (!response.ok) throw new Error(await getApiError(response));

      toast.success("Payout constants saved");
      setQrFile(null);
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to save payout constants");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
      <Card className="rounded-lg">
        <CardHeader>
          <CardTitle>Constants</CardTitle>
          <CardDescription>Values used for partner payouts and tenant credit purchases.</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="space-y-6" onSubmit={form.handleSubmit(onSubmit)}>
            {fieldGroups.map((group) => (
              <section key={group.title} className="space-y-3">
                <h2 className="text-sm font-semibold text-foreground">{group.title}</h2>
                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                  {group.fields.map((field) => (
                    <div key={field.name} className="flex flex-col gap-2">
                      <Label htmlFor={field.name}>{field.label}</Label>
                      <Input
                        id={field.name}
                        type={field.type || "text"}
                        step={field.step}
                        aria-invalid={Boolean(form.formState.errors[field.name])}
                        {...form.register(field.name)}
                      />
                      {form.formState.errors[field.name] ? (
                        <p className="text-sm text-destructive">{form.formState.errors[field.name]?.message}</p>
                      ) : null}
                    </div>
                  ))}
                </div>
              </section>
            ))}

            <section className="space-y-3">
              <h2 className="text-sm font-semibold text-foreground">QR Image</h2>
              <div className="flex flex-col gap-2">
                <Label htmlFor="adminCreditPurchaseQrImage">Admin credit purchase QR image</Label>
                <Input
                  id="adminCreditPurchaseQrImage"
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  aria-invalid={Boolean(qrError)}
                  onChange={(event) => onQrFileChange(event.target.files)}
                />
                {qrError ? <p className="text-sm text-destructive">{qrError}</p> : null}
              </div>
            </section>

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
          <CardTitle>QR Preview</CardTitle>
          <CardDescription>{qrFile ? qrFile.name : "Current payment QR"}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex aspect-square items-center justify-center overflow-hidden rounded-lg border bg-muted/30">
            {selectedQrPreview || currentQrUrl ? (
              <img src={selectedQrPreview || currentQrUrl} alt="Admin credit purchase QR" className="h-full w-full object-contain" />
            ) : (
              <Upload className="h-10 w-10 text-muted-foreground" aria-hidden="true" />
            )}
          </div>
          <div className="space-y-1 text-sm">
            <p className="font-medium">Firebase path</p>
            <p className="break-all text-muted-foreground">{String(payoutConstants.adminCreditPurchaseQrStoragePath || "-")}</p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
