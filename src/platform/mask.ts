/** Shows only the last 4 characters. Values of 4 chars or fewer are fully masked. */
export function maskValue(value: string | null | undefined): string {
  if (!value) return "";
  if (value.length <= 4) return "•".repeat(value.length);
  return "•".repeat(Math.min(value.length - 4, 8)) + value.slice(-4);
}
