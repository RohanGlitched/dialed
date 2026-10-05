export const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3850";
export const REPO_URL = "https://github.com/RohanGlitched/dialed";
export const API = (process.env.NEXT_PUBLIC_API_BASE || "").replace(/\/$/, "");

/** Every page is a numbered sheet in the drawing set. */
export const SHEETS = [
  { n: 1, href: "/", title: "Overview" },
  { n: 2, href: "/read/", title: "Read a gauge" },
  { n: 3, href: "/round/", title: "The round" },
  { n: 4, href: "/gauge/?id=TI-201", title: "Gauge sheet" },
  { n: 5, href: "/desk/", title: "Approvals" },
  { n: 6, href: "/evidence/", title: "Evidence" },
] as const;
