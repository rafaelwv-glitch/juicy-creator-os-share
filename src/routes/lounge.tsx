import { createFileRoute } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { CreatorDashboardView } from "@/components/creator-dashboard";
import { OsFrame, useOsSession } from "@/components/os-frame";

export const Route = createFileRoute("/lounge")({ component: LoungePage });

function LoungePage() {
  const session = useOsSession();
  const { dash, setDash } = session;

  return (
    <OsFrame tab="lounge" session={session}>
      {dash ? (
        <CreatorDashboardView dash={dash} onDashboard={setDash} />
      ) : (
        <div className="flex items-center justify-center py-20 text-sm text-muted">
          <Loader2 className="mr-2 size-4 animate-spin" />
          Loading dashboard…
        </div>
      )}
    </OsFrame>
  );
}
