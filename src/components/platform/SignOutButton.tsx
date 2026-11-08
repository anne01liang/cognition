"use client";

import { signOut } from "next-auth/react";

export function SignOutButton() {
  return (
    <button type="button" className="mt-2 underline" onClick={() => signOut({ callbackUrl: "/login" })}>
      Sign out
    </button>
  );
}
