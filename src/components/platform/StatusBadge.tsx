import { Badge, type BadgeProps } from "@/components/ui/badge";

const VARIANTS: Record<string, BadgeProps["variant"]> = {
  DRAFT: "secondary",
  PENDING: "warning",
  APPROVED: "success",
  REJECTED: "destructive",
  ESCALATED: "info",
  LOW: "success",
  MEDIUM: "warning",
  HIGH: "destructive",
};

export function StatusBadge({ status }: { status: string }) {
  return <Badge variant={VARIANTS[status] ?? "outline"}>{status.replaceAll("_", " ")}</Badge>;
}
