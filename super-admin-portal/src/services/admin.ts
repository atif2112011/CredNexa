import { backendFetch } from "@/lib/backend";
import type { PaginatedResponse, RecordItem } from "@/types/api";

export async function getDashboard() {
  return backendFetch<RecordItem>("/admin/dashboard");
}

export async function getList(path: string, query?: Record<string, string | number | boolean | undefined>) {
  return backendFetch<PaginatedResponse<RecordItem>>(path, { query });
}

export async function getDetail<T = RecordItem>(path: string) {
  return backendFetch<T>(path);
}
