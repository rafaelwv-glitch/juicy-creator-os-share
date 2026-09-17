import { createFileRoute } from "@tanstack/react-router";
import { AccountPasswordPanel } from "@/components/account-password-panel";
import { CloudSyncPanel } from "@/components/cloud-sync-panel";
import { ConnectSourcePanel } from "@/components/connect-source-panel";
import { CronConfigPanel } from "@/components/cron-config-panel";
import { DataToolsPanel } from "@/components/data-tools-panel";
import { DatabaseStatusPanel } from "@/components/db-status";
import { GrokHookPanel } from "@/components/grok-hook-panel";
import { OsFrame, useOsSession } from "@/components/os-frame";

export const Route = createFileRoute("/config")({ component: ConfigPage });

function ConfigPage() {
  const session = useOsSession();
  const { dash, persist, companion, auth, reloadAuth, reloadDash, displayName } = session;

  return (
    <OsFrame tab="config" session={session}>
      <div className="mb-6">
        <CronConfigPanel />
      </div>

      <div className="mb-6">
        <DatabaseStatusPanel persist={persist} />
      </div>

      <div className="mb-6 grid gap-4 lg:grid-cols-2">
        <CloudSyncPanel />
        <GrokHookPanel />
      </div>

      {!companion ? (
        <div className="mb-6">
          <AccountPasswordPanel />
        </div>
      ) : null}

      <div className="mb-6">
        <ConnectSourcePanel auth={auth} onChange={reloadAuth} />
      </div>

      <DataToolsPanel
        snapshot={dash?.snapshot ?? null}
        growth={dash?.growth ?? null}
        accountLabel={displayName}
        onImported={async () => {
          await reloadDash();
        }}
      />
    </OsFrame>
  );
}
