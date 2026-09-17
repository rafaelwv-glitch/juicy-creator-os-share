import { Link, useRouterState } from "@tanstack/react-router";
import { BarChart3, Crosshair, Fingerprint, Home, Newspaper, Rocket, Settings, Smartphone } from "lucide-react";

const items = [
  { to: "/", label: "Home", icon: Home },
  { to: "/lounge", label: "Lounge", icon: BarChart3 },
  { to: "/config", label: "Config", icon: Settings },
  { to: "/publish", label: "Release", icon: Rocket },
  { to: "/new-feed", label: "New", icon: Newspaper },
  { to: "/forensics", label: "Forensics", icon: Fingerprint },
  { to: "/stalker", label: "Stalk", icon: Crosshair },
] as const;

export function MobileNav() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl md:hidden"
      aria-label="Primary"
    >
      <div className="mx-auto grid max-w-lg grid-cols-7 gap-0 px-0.5 pt-1">
        {items.map(({ to, label, icon: Icon }) => {
          const active =
            to === "/"
              ? pathname === "/"
              : pathname === to || pathname.startsWith(`${to}/`);
          return (
            <Link
              key={to}
              to={to}
              className={`flex flex-col items-center gap-0.5 rounded-xl px-1 py-2 text-[10px] font-semibold transition ${
                active ? "text-primary" : "text-muted hover:text-fg"
              }`}
            >
              <span
                className={`grid size-9 place-items-center rounded-xl ${
                  active ? "bg-primary/15 text-primary" : "text-muted"
                }`}
              >
                <Icon className="size-5" strokeWidth={active ? 2.4 : 2} />
              </span>
              {label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

/** Desktop-only secondary link row used in headers */
export function DesktopAppLink() {
  return (
    <Link
      to="/android"
      className="hidden items-center gap-1.5 rounded-lg border border-primary/40 bg-primary/15 px-3 py-1.5 text-xs font-semibold text-primary transition hover:bg-primary/25 md:inline-flex"
    >
      <Smartphone className="size-3.5" />
      Get Android app
    </Link>
  );
}

export function DesktopNavLinks() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const link = (to: string, label: string) => {
    const active = to === "/" ? pathname === "/" : pathname.startsWith(to);
    return (
      <Link
        to={to}
        className={`rounded-lg px-3 py-1.5 text-xs font-medium ${
          active ? "bg-elevated text-fg" : "text-muted hover:text-fg"
        }`}
      >
        {label}
      </Link>
    );
  };
  return (
    <div className="hidden items-center gap-1 md:flex">
      {link("/", "Home")}
      {link("/lounge", "Lounge")}
      {link("/config", "Config")}
      {link("/timing", "Timing")}
      {link("/forensics", "Forensics")}
      {link("/publish", "Release")}
      {link("/followers", "Followers")}
      {link("/insights", "Insights")}
      {link("/new-feed", "New")}
      {link("/stalker", "Stalker")}
      <DesktopAppLink />
    </div>
  );
}
