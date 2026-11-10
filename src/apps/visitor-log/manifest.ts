import { defineApp } from "@/platform/app-manifest";
import { VISITOR_LOG } from "./permissions";

export const visitorLogApp = defineApp({
  id: "visitor-log",
  name: "Visitor log",
  description: "Generic room visit notes (room label and a short note only; no names or personal information).",
  basePath: "/apps/visitor-log",
  permission: VISITOR_LOG.read,
  nav: [
    { label: "Visit notes", href: "/apps/visitor-log", permission: VISITOR_LOG.read },
    { label: "New note", href: "/apps/visitor-log/new", permission: VISITOR_LOG.write },
  ],
});
