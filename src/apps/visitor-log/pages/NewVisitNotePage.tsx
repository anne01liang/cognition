import { requirePagePermission } from "@/platform/session";
import { VISITOR_LOG } from "../permissions";
import { NewVisitNoteForm } from "../components/NewVisitNoteForm";

export default async function NewVisitNotePage() {
  await requirePagePermission(VISITOR_LOG.write);
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">New visit note</h1>
      <p className="text-sm text-muted-foreground">Room label and a short note only. Do not enter names or personal information.</p>
      <NewVisitNoteForm />
    </div>
  );
}
