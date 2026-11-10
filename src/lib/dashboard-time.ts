/** Keep source-local datetime input values as text; only fill in absent seconds. */
export function dashboardTimestamp(value: string): string {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value) ? `${value}:00` : value;
}
