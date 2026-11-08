import { getAppSession } from "@/platform/session";
import { hasPermission } from "@/platform/guard";
import type { Permission } from "@/platform/rbac";
import { maskValue } from "@/platform/mask";
import { RevealButton } from "./RevealButton";

interface MaskedFieldProps {
  /** Raw or already-masked value; only the last 4 chars ever leave the server. */
  value: string | null | undefined;
  entityType: string;
  entityId: string;
  field: string;
  /** UI hint only: hides the Reveal button. The server re-checks in revealPii. */
  revealPermission?: Permission;
}

/** Server component. Never pass raw PII to a client component; use this. */
export async function MaskedField({ value, entityType, entityId, field, revealPermission = "pii:reveal" }: MaskedFieldProps) {
  const session = await getAppSession();
  const masked = maskValue(value);
  return (
    <span className="inline-flex items-center gap-2 font-mono">
      {hasPermission(session, revealPermission) ? (
        <RevealButton masked={masked} entityType={entityType} entityId={entityId} field={field} />
      ) : (
        masked
      )}
    </span>
  );
}
