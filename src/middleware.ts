import { withAuth } from "next-auth/middleware";

// Everything requires a signed-in session except the login page, Auth.js and static assets.
// Authorization (permissions) is still enforced server-side in defineAction / requirePermission.
export default withAuth({ pages: { signIn: "/login" } });

export const config = {
  matcher: ["/((?!login|forbidden|api/auth|_next/static|_next/image|favicon.ico).*)"],
};
