"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { get } from "@/lib/api";
import { Mark } from "./Mark";
import s from "./chrome.module.css";

const NAV = [
  { href: "/read/", label: "Read a gauge" },
  { href: "/round/", label: "The round" },
  { href: "/desk/", label: "Approvals" },
  { href: "/evidence/", label: "Evidence" },
];

export function Header() {
  const path = usePathname();
  const [held, setHeld] = useState<number | null>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    get<{ orders: unknown[] }>("/api/orders?status=held").then((r) => setHeld(r.orders.length)).catch(() => setHeld(null));
  }, [path]);
  useEffect(() => setOpen(false), [path]);
  return (
    <header className={s.header}>
      <div className={`wrap ${s.headerIn}`}>
        <Link href="/" className={s.brand} aria-label="Dialed, home">
          <Mark />
          <span>Dialed</span>
        </Link>
        <button className={s.menu} aria-expanded={open} aria-controls="nav" onClick={() => setOpen(!open)}>
          {open ? "Close" : "Menu"}
        </button>
        <nav id="nav" className={`${s.nav} ${open ? s.navOpen : ""}`} aria-label="Main">
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} aria-current={path?.startsWith(n.href) ? "page" : undefined}>
              {n.label}
              {n.href === "/desk/" && held ? <span className={s.badge} title={`${held} work order${held === 1 ? "" : "s"} waiting`}>{held}</span> : null}
            </Link>
          ))}
        </nav>
      </div>
    </header>
  );
}
