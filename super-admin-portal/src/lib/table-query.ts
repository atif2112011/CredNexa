export type TableSearchParams = Record<string, string | undefined>;

export function tableHref(pathname: string, current: URLSearchParams, updates: TableSearchParams, prefix = "") {
  const params = new URLSearchParams(current);
  Object.entries(updates).forEach(([key, value]) => {
    if (value) params.set(`${prefix}${key}`, value); else params.delete(`${prefix}${key}`);
  });
  return `${pathname}${params.size ? `?${params}` : ""}`;
}

export function tableQuery(params: TableSearchParams, prefix = "") {
  const page = Number(params[`${prefix}page`]);
  const limit = Number(params[`${prefix}limit`]);
  return {
    page: Number.isSafeInteger(page) && page > 0 ? page : 1,
    limit: [20, 50, 100].includes(limit) ? limit : 20,
    search: params[`${prefix}search`] || undefined,
    sortBy: params[`${prefix}sortBy`] || undefined,
    sortOrder: params[`${prefix}sortOrder`] === "asc" ? "asc" : "desc"
  };
}
