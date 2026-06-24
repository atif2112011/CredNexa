"use client";

import { ChevronLeft, ChevronRight, Eye, Loader2, PackagePlus, Upload } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { toast } from "sonner";

import { StatusBadge } from "@/components/data/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { formatDate } from "@/lib/utils";
import type { Pagination, RecordItem } from "@/types/api";

type BuildsTableProps = {
  items: RecordItem[];
  pagination: Pagination;
};

type BuildFormState = {
  channel: string;
  versionName: string;
  versionCode: string;
  minimumSupportedVersionCode: string;
  buildType: string;
  checksumRequired: string;
  releaseNotes: string;
};

const MAX_APK_BYTES = 150 * 1024 * 1024;

const defaultFormState: BuildFormState = {
  channel: "production",
  versionName: "",
  versionCode: "",
  minimumSupportedVersionCode: "",
  buildType: "release",
  checksumRequired: "true",
  releaseNotes: ""
};

function formatBytes(value: unknown) {
  const bytes = Number(value || 0);
  if (!Number.isFinite(bytes) || bytes <= 0) return "-";
  const units = ["B", "KB", "MB", "GB"];
  let size = bytes;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  return `${size.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

function getActorName(value: unknown) {
  if (!value || typeof value !== "object") return "-";
  const actor = value as { name?: string; email?: string };
  return actor.name || actor.email || "-";
}

async function getApiError(response: Response) {
  try {
    const result = (await response.json()) as { error?: string };
    return result.error || "Request failed";
  } catch {
    return "Request failed";
  }
}

function buildDetailRows(build: RecordItem): [string, unknown][] {
  return [
    ["Platform", build.platform],
    ["Package Name", build.packageName],
    ["Channel", build.channel],
    ["Version Name", build.versionName],
    ["Version Code", build.versionCode],
    ["Minimum Supported Code", build.minimumSupportedVersionCode],
    ["Build Type", build.buildType],
    ["Checksum Required", build.checksumRequired ? "Yes" : "No"],
    ["Status", build.status],
    ["APK URL", build.apkUrl],
    ["APK SHA-256", build.apkSha256],
    ["APK Size", formatBytes(build.apkSizeBytes)],
    ["APK MIME Type", build.apkMimeType],
    ["Release Notes", build.releaseNotes],
    ["Published At", formatDate(build.publishedAt as string)],
    ["Published By", getActorName(build.publishedBy)],
    ["Created By", getActorName(build.createdBy)],
    ["Updated By", getActorName(build.updatedBy)],
    ["Created At", formatDate(build.createdAt as string)],
    ["Updated At", formatDate(build.updatedAt as string)]
  ];
}

export function BuildsTable({ items, pagination }: BuildsTableProps) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [isUploadOpen, setIsUploadOpen] = useState(false);
  const [isDetailOpen, setIsDetailOpen] = useState(false);
  const [form, setForm] = useState<BuildFormState>(defaultFormState);
  const [apkFile, setApkFile] = useState<File | null>(null);
  const [formError, setFormError] = useState("");
  const [isUploading, setIsUploading] = useState(false);
  const [selectedBuild, setSelectedBuild] = useState<RecordItem | null>(null);
  const [detailError, setDetailError] = useState("");
  const [isLoadingDetail, setIsLoadingDetail] = useState(false);

  function updateForm(key: keyof BuildFormState, value: string) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function validateUpload() {
    if (!apkFile) return "APK file is required";
    if (!apkFile.name.toLowerCase().endsWith(".apk")) return "APK file must use the .apk extension";
    if (apkFile.size > MAX_APK_BYTES) return "APK file must be 150 MB or smaller";
    if (!form.versionName.trim()) return "Version Name is required";

    const versionCode = Number(form.versionCode);
    const minimumSupportedVersionCode = Number(form.minimumSupportedVersionCode);
    if (!Number.isInteger(versionCode) || versionCode <= 0) return "Version Code must be a positive integer";
    if (!Number.isInteger(minimumSupportedVersionCode) || minimumSupportedVersionCode <= 0) {
      return "Minimum Supported Code must be a positive integer";
    }
    if (versionCode < minimumSupportedVersionCode) {
      return "Version Code must be greater than or equal to Minimum Supported Code";
    }
    if (!["production", "qa"].includes(form.channel)) return "Channel is required";
    if (!["release", "debug", "qa"].includes(form.buildType)) return "Build Type is required";

    return "";
  }

  async function submitBuild(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const validationError = validateUpload();
    setFormError(validationError);
    if (validationError) return;

    const body = new FormData();
    body.append("apkFile", apkFile as File);
    body.append("platform", "android");
    body.append("packageName", "com.crednexa.app");
    body.append("channel", form.channel);
    body.append("versionName", form.versionName.trim());
    body.append("versionCode", form.versionCode);
    body.append("minimumSupportedVersionCode", form.minimumSupportedVersionCode);
    body.append("buildType", form.buildType);
    body.append("checksumRequired", form.checksumRequired);
    body.append("releaseNotes", form.releaseNotes.trim());

    setIsUploading(true);
    try {
      const response = await fetch("/api/admin/app-builds", {
        method: "POST",
        body
      });
      if (!response.ok) throw new Error(await getApiError(response));

      toast.success("Build uploaded successfully");
      setIsUploadOpen(false);
      setForm(defaultFormState);
      setApkFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      router.refresh();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to upload build";
      setFormError(message);
      toast.error(message);
    } finally {
      setIsUploading(false);
    }
  }

  async function openDetail(buildId: string) {
    setIsDetailOpen(true);
    setSelectedBuild(null);
    setDetailError("");
    setIsLoadingDetail(true);
    try {
      const response = await fetch(`/api/admin/app-builds/${buildId}`);
      if (!response.ok) throw new Error(await getApiError(response));
      const result = (await response.json()) as { data: RecordItem };
      setSelectedBuild(result.data);
    } catch (error) {
      setDetailError(error instanceof Error ? error.message : "Unable to load build details");
    } finally {
      setIsLoadingDetail(false);
    }
  }

  function goToPage(page: number) {
    router.push(`/builds?page=${page}`);
  }

  return (
    <>
      <div className="mb-4 flex justify-end">
        <Button type="button" onClick={() => setIsUploadOpen(true)}>
          <PackagePlus className="h-4 w-4" aria-hidden="true" />
          Add Build
        </Button>
      </div>

      <Card className="rounded-lg">
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/40">
                <tr>
                  {["Version Name", "Version Code", "Min Supported Code", "Channel", "Build Type", "Status", "APK Size", "Created At", "Actions"].map((header) => (
                    <th key={header} className="whitespace-nowrap border-b px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      {header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {items.length ? (
                  items.map((build) => {
                    const id = String(build._id || build.id || "");
                    return (
                      <tr
                        key={id}
                        className="cursor-pointer border-b transition-colors last:border-b-0 hover:bg-muted/30"
                        onClick={() => openDetail(id)}
                      >
                        <td className="px-4 py-3.5 font-medium">{String(build.versionName || "-")}</td>
                        <td className="px-4 py-3.5">{String(build.versionCode ?? "-")}</td>
                        <td className="px-4 py-3.5">{String(build.minimumSupportedVersionCode ?? "-")}</td>
                        <td className="px-4 py-3.5 capitalize">{String(build.channel || "-")}</td>
                        <td className="px-4 py-3.5 capitalize">{String(build.buildType || "-")}</td>
                        <td className="px-4 py-3.5">
                          <StatusBadge value={build.status} />
                        </td>
                        <td className="px-4 py-3.5">{formatBytes(build.apkSizeBytes)}</td>
                        <td className="px-4 py-3.5">{formatDate(build.createdAt as string)}</td>
                        <td className="px-4 py-3.5">
                          <Button type="button" variant="ghost" size="sm">
                            <Eye className="h-4 w-4" aria-hidden="true" />
                            View
                          </Button>
                        </td>
                      </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td className="px-4 py-10 text-center text-muted-foreground" colSpan={9}>
                      No builds uploaded yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="flex flex-col gap-3 border-t bg-muted/20 p-4 md:flex-row md:items-center md:justify-between">
            <p className="text-sm text-muted-foreground">
              Page {pagination.page} of {pagination.pages || 1} · {pagination.total} builds
            </p>
            <div className="flex items-center gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => goToPage(pagination.page - 1)} disabled={pagination.page <= 1}>
                <ChevronLeft className="h-4 w-4" aria-hidden="true" />
                Previous
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={() => goToPage(pagination.page + 1)} disabled={pagination.page >= pagination.pages}>
                Next
                <ChevronRight className="h-4 w-4" aria-hidden="true" />
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Dialog open={isUploadOpen} onOpenChange={setIsUploadOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Add Build</DialogTitle>
            <DialogDescription>Upload an Android APK as a draft build. Publishing remains separate.</DialogDescription>
          </DialogHeader>
          <form className="grid gap-4" onSubmit={submitBuild}>
            <div className="grid gap-2">
              <Label htmlFor="apkFile">APK File</Label>
              <Input
                ref={fileInputRef}
                id="apkFile"
                type="file"
                accept=".apk,application/vnd.android.package-archive,application/zip"
                onChange={(event) => setApkFile(event.target.files?.[0] || null)}
              />
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="platform">Platform</Label>
                <Input id="platform" value="android" disabled />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="packageName">Package Name</Label>
                <Input id="packageName" value="com.crednexa.app" disabled />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="channel">Channel</Label>
                <select
                  id="channel"
                  className="h-8 w-full rounded-lg border border-input bg-background px-2.5 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
                  value={form.channel}
                  onChange={(event) => updateForm("channel", event.target.value)}
                >
                  <option value="production">Production</option>
                  <option value="qa">QA</option>
                </select>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="buildType">Build Type</Label>
                <select
                  id="buildType"
                  className="h-8 w-full rounded-lg border border-input bg-background px-2.5 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
                  value={form.buildType}
                  onChange={(event) => updateForm("buildType", event.target.value)}
                >
                  <option value="release">Release</option>
                  <option value="debug">Debug</option>
                  <option value="qa">QA</option>
                </select>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="versionName">Version Name</Label>
                <Input id="versionName" value={form.versionName} onChange={(event) => updateForm("versionName", event.target.value)} placeholder="1.0.15" />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="versionCode">Version Code</Label>
                <Input id="versionCode" type="number" min={1} value={form.versionCode} onChange={(event) => updateForm("versionCode", event.target.value)} placeholder="15" />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="minimumSupportedVersionCode">Min Supported Code</Label>
                <Input
                  id="minimumSupportedVersionCode"
                  type="number"
                  min={1}
                  value={form.minimumSupportedVersionCode}
                  onChange={(event) => updateForm("minimumSupportedVersionCode", event.target.value)}
                  placeholder="10"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="checksumRequired">Checksum Required</Label>
                <select
                  id="checksumRequired"
                  className="h-8 w-full rounded-lg border border-input bg-background px-2.5 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
                  value={form.checksumRequired}
                  onChange={(event) => updateForm("checksumRequired", event.target.value)}
                >
                  <option value="true">Yes</option>
                  <option value="false">No</option>
                </select>
              </div>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="releaseNotes">Release Notes</Label>
              <Textarea id="releaseNotes" value={form.releaseNotes} onChange={(event) => updateForm("releaseNotes", event.target.value)} placeholder="Bug fixes and security improvements" />
            </div>
            {formError ? (
              <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {formError}
              </div>
            ) : null}
            <DialogFooter>
              <Button type="submit" disabled={isUploading}>
                {isUploading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Upload className="h-4 w-4" aria-hidden="true" />}
                {isUploading ? "Uploading..." : "Upload Build"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={isDetailOpen} onOpenChange={setIsDetailOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>Build Details</DialogTitle>
            <DialogDescription>Read-only metadata for the selected uploaded build.</DialogDescription>
          </DialogHeader>
          {isLoadingDetail ? (
            <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              Loading build details...
            </div>
          ) : detailError ? (
            <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {detailError}
            </div>
          ) : selectedBuild ? (
            <div className="overflow-hidden rounded-lg border">
              <table className="w-full text-sm">
                <tbody>
                  {buildDetailRows(selectedBuild).map(([label, value]) => (
                    <tr key={label} className="border-b last:border-b-0">
                      <th className="w-56 bg-muted/40 px-3 py-2 text-left font-medium text-muted-foreground">{label}</th>
                      <td className="break-all px-3 py-2">{String(value ?? "-")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}
