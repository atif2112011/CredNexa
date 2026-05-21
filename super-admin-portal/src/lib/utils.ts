import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatDate(value?: string | null) {
  if (!value) return "-"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "-"
  return new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date)
}

export function getNestedValue<T = unknown>(
  item: Record<string, unknown>,
  key: string
): T | undefined {
  return key.split(".").reduce<unknown>((value, segment) => {
    if (!value || typeof value !== "object") return undefined
    return (value as Record<string, unknown>)[segment]
  }, item) as T | undefined
}
