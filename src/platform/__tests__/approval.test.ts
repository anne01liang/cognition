import { describe, expect, it } from "vitest";
import { decideApproval, FourEyesViolationError, InvalidTransitionError, submitForApproval } from "../approval";

describe("maker-checker", () => {
  it("submit moves DRAFT -> PENDING and records the submitter", () => {
    expect(submitForApproval({ status: "DRAFT", submittedById: null }, "alice")).toEqual({ status: "PENDING", submittedById: "alice" });
  });

  it("approver must differ from submitter (four-eyes)", () => {
    expect(() => decideApproval({ status: "PENDING", submittedById: "alice" }, "APPROVE", "alice")).toThrow(FourEyesViolationError);
    expect(() => decideApproval({ status: "ESCALATED", submittedById: "alice" }, "REJECT", "alice")).toThrow(FourEyesViolationError);
  });

  it.each([
    ["APPROVE", "APPROVED"],
    ["REJECT", "REJECTED"],
    ["ESCALATE", "ESCALATED"],
  ] as const)("PENDING --%s--> %s", (decision, next) => {
    expect(decideApproval({ status: "PENDING", submittedById: "alice" }, decision, "bob")).toEqual({ status: next, decidedById: "bob" });
  });

  it("ESCALATED can be approved/rejected but not re-escalated", () => {
    expect(decideApproval({ status: "ESCALATED", submittedById: "alice" }, "APPROVE", "olivia").status).toBe("APPROVED");
    expect(() => decideApproval({ status: "ESCALATED", submittedById: "alice" }, "ESCALATE", "olivia")).toThrow(InvalidTransitionError);
  });

  it("terminal states cannot change", () => {
    for (const status of ["APPROVED", "REJECTED"] as const) {
      expect(() => decideApproval({ status, submittedById: "alice" }, "APPROVE", "bob")).toThrow(InvalidTransitionError);
    }
  });

  it("a DRAFT cannot be decided", () => {
    expect(() => decideApproval({ status: "DRAFT", submittedById: null }, "APPROVE", "bob")).toThrow(InvalidTransitionError);
  });
});
