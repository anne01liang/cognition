import Link from "next/link";
import { getAppSession } from "@/platform/session";
import { visibleApps } from "@/apps/registry";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { redirect } from "next/navigation";

// Public-to-any-signed-in-user page: only shows apps the user can access.
export default async function HomePage() {
  const session = await getAppSession();
  if (!session) redirect("/login");
  const apps = visibleApps(session.permissions);
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Welcome, {session.name}</h1>
      {apps.length === 0 ? <p className="text-muted-foreground">You have no apps assigned.</p> : null}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {apps.map((app) => (
          <Link key={app.id} href={app.basePath}>
            <Card className="hover:border-primary">
              <CardHeader>
                <CardTitle>{app.name}</CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">{app.description}</CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
