import Link from "next/link";

// Static page (allowlisted in scripts/check-actions.ts).
export default function ForbiddenPage({ searchParams }: { searchParams: { permission?: string } }) {
  return (
    <div className="mx-auto mt-24 max-w-md space-y-4 text-center">
      <h1 className="text-xl font-semibold">Access denied</h1>
      <p className="text-sm text-muted-foreground">You need the permission <code>{searchParams.permission ?? "unknown"}</code>.</p>
      <Link href="/" className="text-sm underline">Back home</Link>
    </div>
  );
}
