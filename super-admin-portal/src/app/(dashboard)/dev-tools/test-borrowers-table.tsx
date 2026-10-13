"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { QrCode, RefreshCw, Search, Smartphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { formatDate } from "@/lib/utils";
import { getDevBorrowerQr } from "@/services/dev-tools.client";
import { dealerModeLabel, provisioningLabel, type DevBorrower, type DevBorrowerList, type DevQr } from "@/types/dev-tools";

const statuses = { PROVISIONED: "Provisioned", PENDING_ENROLLMENT: "Not provisioned", INACTIVE: "Inactive", LINKED_DEVICE_UNAVAILABLE: "Linked device unavailable" };

export function TestBorrowersTable({ data, search }: { data: DevBorrowerList; search: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [searchInput, setSearchInput] = useState(search);
  const [selected, setSelected] = useState<DevBorrower | null>(null);
  const [qr, setQr] = useState<DevQr | null>(null);
  const [qrError, setQrError] = useState("");
  const controller = useRef<AbortController | null>(null);
  const qrTrigger = useRef<HTMLButtonElement | null>(null);
  const { page, limit, total, pages } = data.pagination;
  useEffect(() => { setSearchInput(search); }, [search]);
  useEffect(() => () => controller.current?.abort(), []);

  function navigate(nextPage: number, nextLimit = limit, nextSearch = search) {
    const query = new URLSearchParams({ page: String(nextPage), limit: String(nextLimit) });
    if (nextSearch) query.set("search", nextSearch);
    startTransition(() => router.push(`/dev-tools?${query}`));
  }
  async function showQr(borrower: DevBorrower, button?: HTMLButtonElement) {
    controller.current?.abort();
    const current = new AbortController(); controller.current = current;
    if (button) qrTrigger.current = button;
    setSelected(borrower); setQr(null); setQrError("");
    try {
      const result = await getDevBorrowerQr(borrower._id, current.signal);
      if (!current.signal.aborted) {
        if (!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(result.qrCodeDataUrl) || result.enrollmentMode !== borrower.enrollmentMode) throw new Error("The server returned an invalid enrollment QR. Please retry.");
        setQr(result);
      }
    } catch (error) {
      if (!current.signal.aborted) setQrError(error instanceof Error ? error.message : "Unable to load enrollment QR");
    }
  }
  function closeQr() {
    controller.current?.abort(); setSelected(null); setQr(null); setQrError("");
    startTransition(() => router.refresh());
  }
  return <>
    <Card aria-busy={pending}>
      <CardHeader><CardTitle>Test borrowers</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <form className="flex w-full max-w-lg gap-2" onSubmit={(event) => { event.preventDefault(); navigate(1, limit, searchInput.trim()); }}>
            <label htmlFor="dev-borrower-search" className="sr-only">Search test borrowers by name, mobile, loan ID or dealer</label>
            <Input id="dev-borrower-search" value={searchInput} onChange={(event) => setSearchInput(event.target.value)} placeholder="Name, mobile, loan ID or dealer..." />
            <Button type="submit" variant="outline" disabled={pending}><Search aria-hidden="true" />Search</Button>
          </form>
          <Button type="button" variant="outline" disabled={pending} onClick={() => startTransition(() => router.refresh())}><RefreshCw aria-hidden="true" />Refresh</Button>
        </div>
        <div className="overflow-x-auto rounded-lg border">
          {data.items.length ? <table className="w-full text-sm">
            <thead className="bg-muted/40"><tr>{["Name", "Mobile", "Borrower / Loan ID", "Provisioning Type", "Dealer", "Dealer Mode", "Enrollment Status", "Created At", "Actions"].map((header) => <th key={header} scope="col" className={`whitespace-nowrap border-b px-3 py-3 text-left text-xs font-semibold text-muted-foreground ${header === "Actions" ? "sticky right-0 z-10 border-l bg-muted" : ""}`}>{header}</th>)}</tr></thead>
            <tbody>{data.items.map((borrower) => <tr key={borrower._id} className="border-b last:border-b-0 hover:bg-muted/20">
              <td className="min-w-48 max-w-72 break-words px-3 py-3 font-medium">{borrower.name}</td>
              <td className="px-3 py-3">{borrower.mobile}</td><td className="whitespace-nowrap px-3 py-3">{borrower.loanId}</td>
              <td className="px-3 py-3">{provisioningLabel(borrower.enrollmentMode)}</td><td className="px-3 py-3">{borrower.tenantId?.name || "Dealer unavailable"}</td>
              <td className="px-3 py-3">{dealerModeLabel(borrower.deviceControlMode)}</td><td className="px-3 py-3">{statuses[borrower.enrollmentStatus]}</td>
              <td className="whitespace-nowrap px-3 py-3">{formatDate(borrower.createdAt)}</td>
              <td className="sticky right-0 z-10 border-l bg-card px-3 py-3">{borrower.linkedDeviceId ? <Button asChild variant="outline" size="sm"><Link href={`/devices/${borrower.linkedDeviceId}`}><Smartphone aria-hidden="true" />View Device</Link></Button>
                : borrower.canShowQr ? <Button type="button" variant="outline" size="sm" onClick={(event) => showQr(borrower, event.currentTarget)}><QrCode aria-hidden="true" />Show QR</Button> : <span className="text-muted-foreground">Unavailable</span>}</td>
            </tr>)}</tbody>
          </table> : <p className="p-8 text-center text-muted-foreground">{search ? "No test borrowers match this search." : "No test borrowers yet. Create one above to get started."}</p>}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p role="status" className="text-sm text-muted-foreground">{pending ? "Loading..." : `${total} test borrowers · Page ${page} of ${pages}`}</p>
          <div className="flex items-center gap-3">
            <label htmlFor="dev-page-size" className="text-sm">Rows</label>
            <select id="dev-page-size" value={limit} disabled={pending} onChange={(event) => navigate(1, Number(event.target.value))} className="h-9 rounded-lg border bg-background px-2">{[20, 50, 100].map((value) => <option key={value} value={value}>{value}</option>)}</select>
            <Button variant="outline" size="sm" disabled={pending || page <= 1} onClick={() => navigate(page - 1)}>Previous</Button>
            <Button variant="outline" size="sm" disabled={pending || page >= pages} onClick={() => navigate(page + 1)}>Next</Button>
          </div>
        </div>
      </CardContent>
    </Card>
    <Dialog open={Boolean(selected)} onOpenChange={(open) => { if (!open) closeQr(); }}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg" onCloseAutoFocus={(event) => { event.preventDefault(); qrTrigger.current?.focus(); }}>
        <DialogHeader><DialogTitle>Enrollment QR</DialogTitle><DialogDescription>{selected ? provisioningLabel(selected.enrollmentMode) : ""} · {selected?.mobile}</DialogDescription></DialogHeader>
        <p className="break-all text-sm font-medium">{selected?.name}</p>
        {!qr && !qrError ? <div role="status" className="flex h-64 items-center justify-center rounded-lg border bg-muted/30">Loading enrollment QR...</div> : null}
        {qrError ? <div role="alert" className="space-y-3 rounded-lg border border-destructive/30 p-4"><p className="text-destructive">{qrError}</p><Button variant="outline" onClick={() => selected && showQr(selected)}>Retry QR</Button></div> : null}
        {qr ? <>
          <div className="mx-auto w-full max-w-80 rounded-lg bg-white p-3"><img src={qr.qrCodeDataUrl} alt={`Enrollment QR for ${selected?.name}`} width={512} height={512} className="h-auto w-full" /></div>
          <p className="text-sm">Expires: {formatDate(qr.tokenExpiresAt)}</p><p className="text-sm">Test OTP: <strong>{qr.otp}</strong></p>
          <p className="text-sm text-muted-foreground">{qr.enrollmentMode === "RUNNING_APP" ? "Scan this QR inside the running borrower app." : "Scan this QR during Android device setup."}</p>
        </> : null}
      </DialogContent>
    </Dialog>
  </>;
}
