import { ExternalLink, MapPin, Radio } from "lucide-react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDate } from "@/lib/utils";
import type { RecordItem } from "@/types/api";

function asRecord(value: unknown): RecordItem {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as RecordItem)
    : {};
}

function formatCoordinate(value: unknown) {
  const coordinate = Number(value);
  return Number.isFinite(coordinate) ? coordinate.toFixed(6) : "-";
}

export function DeviceTelemetryPanel({ device }: { device: RecordItem }) {
  const simInfo = asRecord(device.simInfo);
  const location = asRecord(device.lastLocation);
  const latitude = Number(location.latitude);
  const longitude = Number(location.longitude);
  const hasLocation = Number.isFinite(latitude) && Number.isFinite(longitude);
  const mapsUrl = hasLocation
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${latitude},${longitude}`)}`
    : "";

  return (
    <Card>
      <CardHeader>
        <CardTitle>Device Telemetry</CardTitle>
        <CardDescription>Latest SIM identity and location reported by the managed device.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 xl:grid-cols-2">
        <section className="rounded-xl border bg-muted/20 p-4">
          <div className="flex items-center gap-2">
            <Radio className="size-4 text-primary" aria-hidden="true" />
            <h3 className="font-semibold">SIM details</h3>
          </div>
          <dl className="mt-4 grid gap-3 sm:grid-cols-2">
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Operator</dt>
              <dd className="mt-1 font-medium">{String(simInfo.simOperator || "-")}</dd>
            </div>
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Phone number</dt>
              <dd className="mt-1 font-medium">{String(simInfo.phoneNumber || "-")}</dd>
            </div>
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">SIM serial</dt>
              <dd className="mt-1 break-all font-mono text-xs">{String(simInfo.simSerial || "-")}</dd>
            </div>
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Last changed</dt>
              <dd className="mt-1 font-medium">{formatDate(device.simChangedAt as string | undefined)}</dd>
            </div>
          </dl>
        </section>

        <section className="rounded-xl border bg-muted/20 p-4">
          <div className="flex items-center gap-2">
            <MapPin className="size-4 text-primary" aria-hidden="true" />
            <h3 className="font-semibold">Last location</h3>
          </div>
          {hasLocation ? (
            <>
              <dl className="mt-4 grid gap-3 sm:grid-cols-2">
                <div>
                  <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Latitude</dt>
                  <dd className="mt-1 font-mono text-sm">{formatCoordinate(location.latitude)}</dd>
                </div>
                <div>
                  <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Longitude</dt>
                  <dd className="mt-1 font-mono text-sm">{formatCoordinate(location.longitude)}</dd>
                </div>
                <div>
                  <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Accuracy</dt>
                  <dd className="mt-1 font-medium">{Number(location.accuracyMeters).toFixed(1)} m</dd>
                </div>
                <div>
                  <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Captured</dt>
                  <dd className="mt-1 font-medium">{formatDate(location.capturedAt as string | undefined)}</dd>
                </div>
                <div>
                  <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Received</dt>
                  <dd className="mt-1 font-medium">{formatDate(location.receivedAt as string | undefined)}</dd>
                </div>
              </dl>
              <a
                href={mapsUrl}
                target="_blank"
                rel="noreferrer"
                className="mt-4 inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
              >
                Open in Google Maps
                <ExternalLink className="size-3.5" aria-hidden="true" />
              </a>
            </>
          ) : (
            <div className="mt-4 rounded-lg border border-dashed bg-background px-4 py-8 text-center">
              <MapPin className="mx-auto size-7 text-muted-foreground" aria-hidden="true" />
              <p className="mt-2 font-medium">No location reported</p>
              <p className="mt-1 text-xs text-muted-foreground">The previous location remains empty until a valid ping arrives.</p>
            </div>
          )}
        </section>
      </CardContent>
    </Card>
  );
}
