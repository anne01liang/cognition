import { describe, expect, it } from "vitest";
import { requestRefundSchema } from "../schemas";
import { formatMoney } from "../money";

describe("refunds", () => {
  it("amounts are integer cents", () => {
    expect(requestRefundSchema.safeParse({ customerName: "Jo Doe", accountNumber: "12345678", amountCents: 10.5, reason: "dup" }).success).toBe(false);
    expect(requestRefundSchema.safeParse({ customerName: "Jo Doe", accountNumber: "12345678", amountCents: 1050, reason: "dup" }).success).toBe(true);
  });
  it("formats cents", () => {
    expect(formatMoney(12550)).toBe("$125.50");
  });
});
