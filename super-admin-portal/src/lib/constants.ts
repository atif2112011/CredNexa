export const BACKEND_API_URL = process.env.BACKEND_API_URL || "http://localhost:5000/api";

export const SUPER_ADMIN_COOKIE = "crednexa_super_admin_token";
export const SUPER_ADMIN_EMAIL_COOKIE = "crednexa_super_admin_email";
export const REFRESH_COOKIE = process.env.REFRESH_COOKIE_NAME || "refreshToken";

export const EMPTY_PAGINATION = {
  page: 1,
  limit: 20,
  total: 0,
  pages: 0
};
