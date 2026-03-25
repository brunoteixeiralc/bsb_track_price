export function generateDateRange(from: string, days: number): string[] {
  const dates: string[] = [];
  const base = new Date(from + "T12:00:00Z"); // noon UTC evita problemas de DST
  for (let i = 0; i < days; i++) {
    const d = new Date(base);
    d.setUTCDate(d.getUTCDate() + i);
    dates.push(d.toISOString().split("T")[0]);
  }
  return dates;
}
