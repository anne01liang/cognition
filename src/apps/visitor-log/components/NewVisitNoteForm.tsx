"use client";

import { useRouter } from "next/navigation";
import { FormBuilder } from "@/components/platform/FormBuilder";
import { createVisitNote } from "../actions";
import { createVisitNoteSchema } from "../schemas";

export function NewVisitNoteForm() {
  const router = useRouter();
  return (
    <FormBuilder
      schema={createVisitNoteSchema}
      action={createVisitNote}
      submitLabel="Create note"
      fields={{ roomLabel: { placeholder: "Room 4B" }, note: { textarea: true } }}
      onSuccess={(data) => router.push(`/apps/visitor-log/${data.id}`)}
    />
  );
}
