import { requirePagePermission } from "@/platform/session";
import { KYC } from "../permissions";
import { NewCaseForm } from "../components/NewCaseForm";

export default async function NewCasePage() {
  await requirePagePermission(KYC.create);
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">New KYC case</h1>
      <NewCaseForm />
    </div>
  );
}
