"use client";

import { Loader2, Save } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type DiscountSlab = {
  minKeys: number;
  maxKeys: number | null;
  discountPercentage: number;
};

const DEFAULT_SLABS: DiscountSlab[] = [
  { minKeys: 0, maxKeys: 25, discountPercentage: 0 },
  { minKeys: 26, maxKeys: 75, discountPercentage: 10 },
  { minKeys: 76, maxKeys: 150, discountPercentage: 15 },
  { minKeys: 151, maxKeys: 250, discountPercentage: 20 },
  { minKeys: 251, maxKeys: 450, discountPercentage: 25 },
  { minKeys: 451, maxKeys: 750, discountPercentage: 30 },
  { minKeys: 751, maxKeys: null, discountPercentage: 35 }
];

const getApiError = async (response: Response) => {
  try {
    const payload = (await response.json()) as { error?: string; message?: string };
    return payload.error || payload.message || "Unable to save discount slabs";
  } catch {
    return "Unable to save discount slabs";
  }
};

const normalizeInitialSlabs = (slabs: DiscountSlab[]) =>
  slabs.length === DEFAULT_SLABS.length
    ? slabs.map((slab, index) => ({ ...DEFAULT_SLABS[index], discountPercentage: Number(slab.discountPercentage) }))
    : DEFAULT_SLABS.map((slab) => ({ ...slab }));

export function DiscountSlabsForm({
  tenantId,
  initialSlabs,
  initialVersion,
  maximumPurchase = 2000
}: {
  tenantId: string;
  initialSlabs: DiscountSlab[];
  initialVersion: number;
  maximumPurchase?: number;
}) {
  const router = useRouter();
  const normalizedInitialSlabs = useMemo(() => normalizeInitialSlabs(initialSlabs), [initialSlabs]);
  const [currentSlabs, setCurrentSlabs] = useState(normalizedInitialSlabs);
  const [values, setValues] = useState(normalizedInitialSlabs.map((slab) => String(slab.discountPercentage)));
  const [version, setVersion] = useState(initialVersion || 1);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const errors = values.map((value, index) => {
    const percentage = Number(value);
    if (index === 0 && percentage !== 0) return "This slab is fixed at 0%";
    if (value.trim() === "" || !Number.isFinite(percentage)) return "Enter a valid percentage";
    if (percentage < 0 || percentage > 50) return "Enter a value from 0% to 50%";
    return "";
  });

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (errors.some(Boolean)) return;

    const slabs = currentSlabs.map((slab, index) => ({
      minKeys: slab.minKeys,
      maxKeys: slab.maxKeys,
      discountPercentage: Number(values[index])
    }));

    setIsSubmitting(true);
    try {
      const response = await fetch(`/api/admin/tenants/${tenantId}/credit-purchase-discounts`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ discountConfigVersion: version, slabs })
      });
      if (!response.ok) throw new Error(await getApiError(response));

      const payload = (await response.json()) as {
        data?: { discountConfigVersion?: number; slabs?: DiscountSlab[] };
      };
      const savedSlabs = normalizeInitialSlabs(payload.data?.slabs || slabs);
      setCurrentSlabs(savedSlabs);
      setValues(savedSlabs.map((slab) => String(slab.discountPercentage)));
      setVersion(payload.data?.discountConfigVersion || version + 1);
      toast.success("Discount slabs saved");
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to save discount slabs");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Discount Slabs</CardTitle>
        <CardDescription>
          Discounts apply to the complete key purchase. The 0–25 slab is fixed; every other value can be set up to 50%.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form className="space-y-5" onSubmit={submit}>
          <div className="overflow-x-auto">
            <div className="min-w-[560px] space-y-3">
              <div className="grid grid-cols-[1fr_1fr_1.2fr] gap-4 border-b pb-2 text-sm font-medium text-muted-foreground">
                <span>Key slab</span>
                <span>Current value</span>
                <span>New value</span>
              </div>
              {currentSlabs.map((slab, index) => {
                const upperLabel = slab.maxKeys === null ? maximumPurchase : slab.maxKeys;
                const slabLabel = `${slab.minKeys}–${upperLabel}`;
                return (
                  <div className="grid grid-cols-[1fr_1fr_1.2fr] items-start gap-4" key={`${slab.minKeys}-${slab.maxKeys}`}>
                    <span className="py-2 text-sm font-medium">{slabLabel} keys</span>
                    <span className="py-2 text-sm">{slab.discountPercentage}%</span>
                    <div className="space-y-1">
                      <Label className="sr-only" htmlFor={`discount-slab-${index}`}>{`New discount for ${slabLabel} keys`}</Label>
                      <div className="relative">
                        <Input
                          id={`discount-slab-${index}`}
                          type="number"
                          min="0"
                          max="50"
                          step="0.01"
                          value={values[index]}
                          disabled={index === 0 || isSubmitting}
                          aria-invalid={Boolean(errors[index])}
                          onChange={(event) => {
                            const next = [...values];
                            next[index] = event.target.value;
                            setValues(next);
                          }}
                        />
                        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">%</span>
                      </div>
                      {index === 0 ? <p className="text-xs text-muted-foreground">Fixed</p> : null}
                      {errors[index] ? <p className="text-xs text-destructive">{errors[index]}</p> : null}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
          <div className="flex justify-end border-t pt-4">
            <Button type="submit" disabled={isSubmitting || errors.some(Boolean)}>
              {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Save className="h-4 w-4" aria-hidden="true" />}
              {isSubmitting ? "Saving..." : "Save discount slabs"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
