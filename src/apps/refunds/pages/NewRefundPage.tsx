import { requirePagePermission } from "@/platform/session";
import { REFUND } from "../permissions";
import { NewRefundForm } from "../components/NewRefundForm";

export default async function NewRefundPage() {
  await requirePagePermission(REFUND.request);
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Request refund</h1>
      <NewRefundForm />
    </div>
  );
}
