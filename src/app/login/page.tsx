import { mockSsoEnabled } from "@/platform/auth";
import { LoginButtons } from "./LoginButtons";

// Unauthenticated page (allowlisted in scripts/check-actions.ts).
export default function LoginPage() {
  return (
    <div className="mx-auto mt-24 max-w-md space-y-6 rounded-lg border p-8">
      <h1 className="text-xl font-semibold">Sign in</h1>
      {mockSsoEnabled() ? (
        <>
          <p className="text-sm text-muted-foreground">Mock SSO (development only). Choose a seeded user:</p>
          <LoginButtons />
        </>
      ) : (
        <p className="text-sm text-red-600">No SSO provider is configured.</p>
      )}
    </div>
  );
}
