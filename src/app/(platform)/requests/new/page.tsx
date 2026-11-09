import { requirePagePermission } from "@/platform/session";
import { RequestForm } from "@/platform/requests/components/RequestForm";

export default async function NewToolRequestPage() {
  await requirePagePermission("tools:request");
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Request a new tool</h1>
        <p className="text-sm text-muted-foreground">
          Describe the tool. The platform turns it into a validated manifest; after an admin approves it, Devin builds the app and opens a PR.
        </p>
      </div>
      <RequestForm />
    </div>
  );
}
