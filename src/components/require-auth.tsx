import { useEffect, useState, type ReactNode } from "react";
import { useRouterState } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { authEnabled } from "@/lib/auth/client";
import { captureDeviceFromLocation, getDeviceToken } from "@/lib/auth/device-client";
import { RedirectToSignIn } from "@/lib/auth/gates";
import { useCurrentUserState } from "@/lib/auth/use-current-user";

const OPEN = new Set(["/login", "/phone"]);

export function RequireAuth({ children }: { children: ReactNode }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { user, isPending } = useCurrentUserState();
  const [device, setDevice] = useState<string | null>(() =>
    typeof window === "undefined" ? null : getDeviceToken(),
  );

  useEffect(() => {
    captureDeviceFromLocation();
    setDevice(getDeviceToken());
  }, [pathname]);

  if (!authEnabled) return <>{children}</>;
  if (
    OPEN.has(pathname) ||
    pathname.startsWith("/api/") ||
    pathname.startsWith("/auth/")
  ) {
    return <>{children}</>;
  }
  if (device) return <>{children}</>;
  if (isPending) {
    return (
      <div className="grid min-h-[60dvh] place-items-center text-muted">
        <div className="flex items-center gap-2 text-sm">
          <Loader2 className="size-4 animate-spin text-primary" />
          Checking account…
        </div>
      </div>
    );
  }
  if (!user) return <RedirectToSignIn />;
  return <>{children}</>;
}
