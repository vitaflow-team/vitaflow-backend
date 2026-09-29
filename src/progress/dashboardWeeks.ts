export const DASHBOARD_WEEKS = [4, 8, 12] as const;
export const DEFAULT_DASHBOARD_WEEKS = 8;
export type DashboardWeeks = (typeof DASHBOARD_WEEKS)[number];
