/**
 * CI guardrail for prisma/schema.prisma:
 *  - fields whose NAME looks like personal data must carry `/// @pii`
 *  - fields whose NAME looks like money must carry `/// @money`
 *  - `@money` fields must be Int / BigInt (minor units) or Decimal, never Float
 *
 * Usage: tsx scripts/check-schema.ts [path/to/schema.prisma]
 */
import fs from "node:fs";
import path from "node:path";

export const PII_NAME = /(ssn|taxid|tin$|passport|document(number|no)|dob|dateofbirth|birth|email|phone|mobile|address|postcode|zip|iban|accountnumber|cardnumber|pan$|^name$|firstname|lastname|fullname|customername|nationalid)/i;
export const MONEY_NAME = /(amount|price|balance|fee|cost|total|cents|salary|payout|refundvalue)/i;

export interface SchemaViolation {
  line: number;
  message: string;
}

export function checkSchema(text: string): SchemaViolation[] {
  const v: SchemaViolation[] = [];
  let inModel: string | null = null;
  let docs: string[] = [];
  text.split("\n").forEach((rawLine, i) => {
    const line = rawLine.trim();
    const n = i + 1;
    const model = line.match(/^model\s+(\w+)\s*\{/);
    if (model) {
      inModel = model[1]!;
      docs = [];
      return;
    }
    if (inModel && line.startsWith("}")) {
      inModel = null;
      return;
    }
    if (!inModel) return;
    if (line.startsWith("///")) {
      docs.push(line);
      return;
    }
    const field = line.match(/^(\w+)\s+(\w+)(\[\])?(\?)?/);
    if (!field || line.startsWith("@@")) {
      docs = [];
      return;
    }
    const [, name, type] = field as unknown as [string, string, string];
    const doc = docs.join(" ");
    docs = [];
    const isPii = /@pii\b/.test(doc);
    const isMoney = /@money\b/.test(doc);
    if (PII_NAME.test(name) && !isPii) v.push({ line: n, message: `${inModel}.${name} looks like personal data but has no "/// @pii" comment.` });
    if (MONEY_NAME.test(name) && !isMoney) v.push({ line: n, message: `${inModel}.${name} looks like money but has no "/// @money" comment.` });
    if (isMoney && !["Int", "BigInt", "Decimal"].includes(type)) {
      v.push({ line: n, message: `${inModel}.${name} is @money but has type ${type}; use Int/BigInt minor units or Decimal.` });
    }
  });
  return v;
}

function main() {
  const file = process.argv[2] ?? path.resolve(__dirname, "../prisma/schema.prisma");
  const violations = checkSchema(fs.readFileSync(file, "utf8"));
  if (violations.length) {
    console.error(`check-schema: ${violations.length} violation(s) in ${path.relative(process.cwd(), file)}`);
    for (const x of violations) console.error(`  line ${x.line}: ${x.message}`);
    process.exit(1);
  }
  console.log("check-schema: OK");
}

if (require.main === module) main();
