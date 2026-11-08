"use client";

import { signIn } from "next-auth/react";
import { Button } from "@/components/ui/button";

const USERS = [
  ["alice", "kyc_analyst"],
  ["bob", "kyc_approver"],
  ["carol", "support"],
  ["dan", "finance_approver"],
  ["erin", "admin"],
  ["olivia", "ops_lead"],
] as const;

export function LoginButtons() {
  return (
    <div className="grid gap-2">
      {USERS.map(([username, role]) => (
        <Button key={username} variant="outline" className="justify-between" onClick={() => signIn("mock-sso", { username, callbackUrl: "/" })}>
          <span className="capitalize">{username}</span>
          <span className="text-xs text-muted-foreground">{role}</span>
        </Button>
      ))}
    </div>
  );
}
