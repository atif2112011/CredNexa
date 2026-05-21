export type ApiResponse<T> = {
  success: boolean;
  message?: string;
  data: T;
  error?: string;
};

export type Pagination = {
  page: number;
  limit: number;
  total: number;
  pages: number;
};

export type PaginatedResponse<T> = {
  items: T[];
  pagination: Pagination;
};

export type RecordItem = Record<string, unknown> & {
  _id?: string;
  id?: string;
};
