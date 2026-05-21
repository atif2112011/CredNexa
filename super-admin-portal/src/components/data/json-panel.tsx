import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function JsonPanel({ title, data }: { title: string; data: unknown }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <pre className="max-h-[420px] overflow-auto rounded-md bg-muted p-4 text-xs leading-relaxed">
          {JSON.stringify(data, null, 2)}
        </pre>
      </CardContent>
    </Card>
  );
}
