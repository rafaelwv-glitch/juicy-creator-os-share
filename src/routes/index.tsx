import { createFileRoute } from "@tanstack/react-router";
import { OsFrame, useOsSession } from "@/components/os-frame";
import { QuickSummary } from "@/components/quick-summary";

export const Route = createFileRoute("/")({ component: SummaryPage });

function SummaryPage() {
  const session = useOsSession();
  return (
    <OsFrame tab="summary" session={session}>
      <QuickSummary
        briefing={session.dash?.briefing}
        jobs={session.jobs}
        loading={!session.dash && !session.msg}
      />
    </OsFrame>
  );
}
