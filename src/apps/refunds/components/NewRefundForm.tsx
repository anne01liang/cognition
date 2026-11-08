"use client";

import { useRouter } from "next/navigation";
import { FormBuilder } from "@/components/platform/FormBuilder";
import { requestRefund } from "../actions";
import { requestRefundSchema } from "../schemas";

export function NewRefundForm() {
  const router = useRouter();
  return (
    <FormBuilder
      schema={requestRefundSchema}
      action={requestRefund}
      submitLabel="Submit request"
      fields={{ reason: { textarea: true } }}
      onSuccess={(d) => router.push(`/apps/refunds/${d.id}`)}
    />
  );
}
