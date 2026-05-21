import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDate, getNestedValue } from "@/lib/utils";
import type { RecordItem } from "@/types/api";

export type DetailField = {
  label: string;
  key: string;
  type?: "date" | "boolean";
};

export function DetailGrid({ title, data, fields }: { title: string; data: RecordItem; fields: DetailField[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <dl className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {fields.map((field) => {
            const rawValue = getNestedValue(data, field.key);
            const value = field.type === "date" ? formatDate(rawValue as string) : field.type === "boolean" ? (rawValue ? "Yes" : "No") : String(rawValue ?? "-");
            return (
              <div key={field.key} className="rounded-xl border bg-muted/20 p-4 ring-1 ring-transparent">
                <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{field.label}</dt>
                <dd className="mt-2 break-words text-sm font-semibold text-foreground">{value}</dd>
              </div>
            );
          })}
        </dl>
      </CardContent>
    </Card>
  );
}
