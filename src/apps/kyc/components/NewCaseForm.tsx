"use client";

import { useRouter } from "next/navigation";
import { FormBuilder } from "@/components/platform/FormBuilder";
import { createCase } from "../actions";
import { createCaseSchema } from "../schemas";

export function NewCaseForm() {
  const router = useRouter();
  return (
    <FormBuilder
      schema={createCaseSchema}
      action={createCase}
      submitLabel="Create case"
      fields={{ notes: { textarea: true }, country: { placeholder: "US" } }}
      onSuccess={(data) => router.push(`/apps/kyc/${data.id}`)}
    />
  );
}
