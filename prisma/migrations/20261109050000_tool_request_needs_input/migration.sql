-- A Devin session that is blocked waiting for a person's answer.
ALTER TYPE "ToolRequestStatus" ADD VALUE 'NEEDS_INPUT' AFTER 'BUILDING';
