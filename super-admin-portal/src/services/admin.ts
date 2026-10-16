import { backendFetch } from "@/lib/backend";
import type { PaginatedResponse, RecordItem } from "@/types/api";

export async function getDashboard() {
  return backendFetch<RecordItem>("/admin/dashboard");
}

export async function getList(path: string, query?: Record<string, string | number | boolean | undefined>) {
  return backendFetch<PaginatedResponse<RecordItem>>(path, { query });
}

// Dropdowns need every option; the backend caps each response at 100 records.
export async function getAllList(path: string, query?: Record<string, string | number | boolean | undefined>) {
  const first = await getList(path, { ...query, page: 1, limit: 100 });
  const items = [...first.items];
  for (let page = 2; page <= first.pagination.pages; page += 1) {
    const next = await getList(path, { ...query, page, limit: 100 });
    items.push(...next.items);
  }
  return { ...first, items };
}

export async function getDetail<T = RecordItem>(path: string, query?: Record<string, string | number | boolean | undefined>) {
  return backendFetch<T>(path, { query });
}
