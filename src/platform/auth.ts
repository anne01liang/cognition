import type { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import { db } from "./db";

export function mockSsoEnabled(): boolean {
  return process.env.NODE_ENV !== "production" && process.env.MOCK_SSO_ENABLED === "true";
}

/**
 * Auth.js config. The "mock-sso" provider simulates corporate SSO for local
 * development: pick a seeded user, no password. It is hard-disabled in
 * production. Replace with a real OIDC provider (Okta/Entra) before go-live.
 */
export const authOptions: NextAuthOptions = {
  session: { strategy: "jwt", maxAge: 8 * 60 * 60 },
  pages: { signIn: "/login" },
  providers: [
    CredentialsProvider({
      id: "mock-sso",
      name: "Mock SSO",
      credentials: { username: { label: "Username", type: "text" } },
      async authorize(credentials) {
        if (!mockSsoEnabled()) return null;
        const username = credentials?.username;
        if (typeof username !== "string" || username.length > 64) return null;
        const user = await db.user.findUnique({ where: { username } });
        if (!user) return null;
        return { id: user.id, name: user.name, email: user.email };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) token.uid = user.id;
      return token;
    },
    async session({ session, token }) {
      if (session.user && typeof token.uid === "string") session.user.id = token.uid;
      return session;
    },
  },
};
