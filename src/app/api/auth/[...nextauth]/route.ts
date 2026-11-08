import NextAuth from "next-auth";
import { authOptions } from "@/platform/auth";

// Auth.js endpoints are intentionally unauthenticated (allowlisted in scripts/check-actions.ts).
const handler = NextAuth(authOptions);
export { handler as GET, handler as POST };
