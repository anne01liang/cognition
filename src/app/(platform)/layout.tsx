import Link from "next/link";
import { redirect } from "next/navigation";
import { getAppSession } from "@/platform/session";
import { hasPermission } from "@/platform/guard";
import { visibleApps } from "@/apps/registry";
import { SignOutButton } from "@/components/platform/SignOutButton";

export const dynamic = "force-dynamic";

export default async function PlatformLayout({ children }: { children: React.ReactNode }) {
  const session = await getAppSession();
  if (!session) redirect("/login");
  const apps = visibleApps(session.permissions);

  return (
    <div className="flex min-h-screen">
      <aside className="w-60 shrink-0 border-r bg-muted/40 p-4">
        <Link href="/" className="mb-6 block text-lg font-semibold">
          Internal Tools
        </Link>
        <nav className="space-y-5 text-sm">
          {apps.map((app) => (
            <div key={app.id}>
              <div className="mb-1 font-medium text-muted-foreground">{app.name}</div>
              <ul className="space-y-1">
                {app.nav.map((item) => (
                  <li key={item.href}>
                    <Link href={item.href} className="block rounded px-2 py-1 hover:bg-accent">
                      {item.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
          {hasPermission(session, "audit:read") ? (
            <div>
              <div className="mb-1 font-medium text-muted-foreground">Admin</div>
              <Link href="/admin/audit" className="block rounded px-2 py-1 hover:bg-accent">
                Audit log
              </Link>
            </div>
          ) : null}
        </nav>
        <div className="mt-8 border-t pt-4 text-xs text-muted-foreground">
          <div className="font-medium text-foreground">{session.name}</div>
          <div>{session.roles.join(", ")}</div>
          <SignOutButton />
        </div>
      </aside>
      <main className="flex-1 p-8">{children}</main>
    </div>
  );
}
