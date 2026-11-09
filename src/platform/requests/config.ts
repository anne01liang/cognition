import "server-only";

/** Team charged for a request = the first of the requester's roles that maps to a team. */
export const ROLE_TEAM: Record<string, string> = {
  ops_lead: "operations",
  admin: "platform",
  support: "operations",
  kyc_analyst: "compliance",
  kyc_approver: "compliance",
  finance_approver: "finance",
};

const DEFAULT_BUDGETS: Record<string, number> = { operations: 100, platform: 60, compliance: 80, finance: 80 };

/** Monthly ACU budget per team. Override with TOOL_REQUEST_TEAM_BUDGETS='{"operations":150}'. */
export function teamBudgets(): Record<string, number> {
  const raw = process.env.TOOL_REQUEST_TEAM_BUDGETS;
  if (!raw) return DEFAULT_BUDGETS;
  try {
    return { ...DEFAULT_BUDGETS, ...(JSON.parse(raw) as Record<string, number>) };
  } catch {
    throw new Error("TOOL_REQUEST_TEAM_BUDGETS must be a JSON object of team -> ACUs");
  }
}

export function teamFor(roles: readonly string[]): string {
  for (const r of roles) if (ROLE_TEAM[r]) return ROLE_TEAM[r]!;
  return "unassigned";
}

/** Start of the current calendar month, UTC. */
export function monthStart(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}
