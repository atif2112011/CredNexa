"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { FlaskConical, Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { createDevBorrower, getDevDealers } from "@/services/dev-tools.client";
import { dealerModeLabel, type DevCreation, type DevDealerList, type EnrollmentMode } from "@/types/dev-tools";

const schema = z.object({ enrollmentMode: z.enum(["DEVICE_OWNER_QR", "RUNNING_APP"]), tenantId: z.string().min(1, "Select a dealer") });
type Values = z.infer<typeof schema>;

export function CreateTestBorrower({ pageSize }: { pageSize: number }) {
  const router = useRouter();
  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { enrollmentMode: "DEVICE_OWNER_QR", tenantId: "" } });
  const mode = form.watch("enrollmentMode");
  const [dealerPage, setDealerPage] = useState(1);
  const [dealerSearch, setDealerSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [dealers, setDealers] = useState<DevDealerList | null>(null);
  const [loading, setLoading] = useState(true);
  const [lookupError, setLookupError] = useState("");
  const [submitError, setSubmitError] = useState("");
  const [created, setCreated] = useState<DevCreation | null>(null);
  const [retry, setRetry] = useState(0);
  const lookupId = useRef(0);

  useEffect(() => {
    const controller = new AbortController();
    const id = ++lookupId.current;
    setLoading(true); setLookupError(""); setDealers(null);
    getDevDealers(mode, dealerPage, dealerSearch, controller.signal).then((data) => {
      if (id === lookupId.current && !controller.signal.aborted) setDealers(data);
    }).catch((error: Error) => {
      if (id === lookupId.current && !controller.signal.aborted) setLookupError(error.message);
    }).finally(() => {
      if (id === lookupId.current && !controller.signal.aborted) setLoading(false);
    });
    return () => controller.abort();
  }, [mode, dealerPage, dealerSearch, retry]);

  function changeMode(value: EnrollmentMode) {
    ++lookupId.current;
    form.setValue("enrollmentMode", value); form.setValue("tenantId", "");
    setDealerPage(1); setDealerSearch(""); setSearchInput(""); setDealers(null); setLoading(true);
    setSubmitError("");
  }
  function searchDealers() {
    ++lookupId.current;
    form.setValue("tenantId", ""); setDealerPage(1); setDealerSearch(searchInput.trim()); setRetry((value) => value + 1);
  }
  function changeDealerPage(page: number) {
    ++lookupId.current;
    form.setValue("tenantId", ""); setDealerPage(page);
  }
  async function submit(values: Values) {
    setSubmitError(""); setCreated(null);
    try {
      const result = await createDevBorrower(values.tenantId, values.enrollmentMode);
      setCreated(result); toast.success("Test borrower created. No dealer key charged.");
      // Show the newly created row while preserving the creation selectors.
      router.replace(`/dev-tools?limit=${pageSize}`); router.refresh();
    } catch (error) {
      setSubmitError(`${error instanceof Error ? error.message : "Creation failed."} Refresh the table before retrying if the connection was interrupted.`);
    }
  }
  const pending = form.formState.isSubmitting;
  return <Card>
    <CardHeader>
      <CardTitle>Create Test Borrower</CardTitle>
      <CardDescription>Generated test identity, a ₹12,000 loan and six ₹2,000 EMIs. No dealer key is charged.</CardDescription>
    </CardHeader>
    <CardContent className="space-y-4">
      <form onSubmit={form.handleSubmit(submit)} className="space-y-4">
        <fieldset disabled={pending} className="space-y-3">
          <legend className="mb-2 font-medium">Provisioning type</legend>
          <div className="grid gap-3 sm:grid-cols-2">
            {([["DEVICE_OWNER_QR", "QR Provisioned", "Enrollment during Android setup."], ["RUNNING_APP", "Running Provisioned", "Enrollment inside the running borrower app."]] as const).map(([value, label, hint]) =>
              <label key={value} className={`flex cursor-pointer items-start gap-3 rounded-lg border p-4 ${mode === value ? "border-primary bg-primary/5" : "bg-background"}`}>
                <input type="radio" name="enrollmentMode" value={value} checked={mode === value} onChange={() => changeMode(value)} className="mt-1 accent-primary" />
                <span><span className="block font-medium">{label}</span><span className="text-xs text-muted-foreground">{hint}</span></span>
              </label>)}
          </div>
          <div className="space-y-2 pt-2">
            <label htmlFor="dev-dealer-search" className="font-medium">Search dealers</label>
            <div className="flex max-w-xl gap-2">
              <Input id="dev-dealer-search" value={searchInput} onChange={(event) => setSearchInput(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); searchDealers(); } }} placeholder="Dealer name..." />
              <Button type="button" variant="outline" onClick={searchDealers}><Search aria-hidden="true" />Search</Button>
            </div>
          </div>
          <div className="space-y-2">
            <label htmlFor="dev-dealer" className="font-medium">Select a dealer</label>
            <select id="dev-dealer" {...form.register("tenantId")} disabled={pending || loading || !dealers?.items.length} aria-describedby="dev-dealer-status" className="h-10 w-full max-w-xl rounded-lg border bg-background px-3 outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <option value="">{loading ? "Loading dealers..." : "Select a dealer"}</option>
              {dealers?.items.map((dealer) => <option key={dealer._id} value={dealer._id}>{dealer.name} — {dealerModeLabel(dealer.deviceControlMode)}</option>)}
            </select>
            <p id="dev-dealer-status" role="status" className="text-xs text-muted-foreground">{loading ? "Loading eligible dealers..." : lookupError ? lookupError : dealers?.items.length ? `${dealers.pagination.total} eligible dealers. Zero-key dealers can also create these test borrowers.` : "No eligible dealers match this provisioning type and search."}</p>
            {lookupError ? <Button type="button" variant="outline" onClick={() => setRetry((value) => value + 1)}>Retry dealer lookup</Button> : null}
            {form.formState.errors.tenantId ? <p role="alert" className="text-sm text-destructive">{form.formState.errors.tenantId.message}</p> : null}
            {dealers && dealers.pagination.pages > 1 ? <div className="flex items-center gap-3">
              <Button type="button" variant="outline" size="sm" disabled={dealerPage <= 1} onClick={() => changeDealerPage(dealerPage - 1)}>Previous dealers</Button>
              <span className="text-xs">Dealer page {dealerPage} of {dealers.pagination.pages}</span>
              <Button type="button" variant="outline" size="sm" disabled={dealerPage >= dealers.pagination.pages} onClick={() => changeDealerPage(dealerPage + 1)}>Next dealers</Button>
            </div> : null}
          </div>
        </fieldset>
        {submitError ? <p role="alert" className="rounded-lg border border-destructive/30 p-3 text-sm text-destructive">{submitError}</p> : null}
        <Button type="submit" disabled={pending || loading || !dealers?.items.length}><FlaskConical aria-hidden="true" />{pending ? "Creating..." : "Create Test Borrower"}</Button>
      </form>
      {created ? <div role="status" className="space-y-1 rounded-lg border bg-muted/30 p-4 text-sm">
        <p className="break-all font-medium">{created.borrower.name}</p>
        <p>Mobile: <strong>{created.borrower.mobile}</strong> · Test OTP: <strong>{created.otp}</strong></p>
        <p className="text-muted-foreground">Use Show QR in the table to onboard the phone.</p>
      </div> : null}
    </CardContent>
  </Card>;
}
