import { useState } from "react";
import { KeyRound, Loader2 } from "lucide-react";
import { issuePasswordResetLink, setSignedInPassword } from "@/lib/auth/password-actions";

export function AccountPasswordPanel() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [ok, setOk] = useState<boolean | null>(null);
  const [link, setLink] = useState<string | null>(null);

  const save = async () => {
    setBusy(true);
    setMsg(null);
    setOk(null);
    try {
      const res = await setSignedInPassword({
        data: { newPassword: next, currentPassword: current || undefined },
      });
      setOk(true);
      setMsg(
        res.mode === "changed"
          ? "Password changed. Use it on the phone now."
          : "Password set. Use it on the phone now.",
      );
      setCurrent("");
      setNext("");
    } catch (e) {
      setOk(false);
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const mintLink = async () => {
    setBusy(true);
    setMsg(null);
    setOk(null);
    try {
      const res = await issuePasswordResetLink({ data: {} });
      setLink(res.url);
      setOk(true);
      setMsg("One-hour reset link ready. Open it on the phone.");
    } catch (e) {
      setOk(false);
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="rounded-2xl border border-border bg-surface/80 p-4">
      <div className="mb-3 flex items-center gap-2">
        <KeyRound className="size-4 text-primary" />
        <h2 className="text-sm font-semibold">Lounge password</h2>
      </div>
      <p className="mb-3 text-[12px] text-muted">
        You are signed in here. Set a password this browser and the phone both use. Current
        password is optional if you no longer remember it.
      </p>
      <form
        className="space-y-2"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <input
          type="password"
          autoComplete="current-password"
          placeholder="Current password (if you know it)"
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
          className="h-10 w-full rounded-xl border border-border bg-bg px-3 text-sm"
        />
        <input
          type="password"
          required
          minLength={8}
          autoComplete="new-password"
          placeholder="New password (8+ chars)"
          value={next}
          onChange={(e) => setNext(e.target.value)}
          className="h-10 w-full rounded-xl border border-border bg-bg px-3 text-sm"
        />
        <button
          type="submit"
          disabled={busy || next.length < 8}
          className="inline-flex h-10 items-center gap-2 rounded-xl bg-primary px-3 text-sm font-semibold text-primary-fg disabled:opacity-55"
        >
          {busy ? <Loader2 className="size-4 animate-spin" /> : null}
          Save password
        </button>
      </form>
      <button
        type="button"
        disabled={busy}
        onClick={() => void mintLink()}
        className="mt-2 text-[12px] text-muted underline-offset-2 hover:text-fg hover:underline"
      >
        Make a one-time reset link for the phone
      </button>
      {link ? (
        <p className="mt-2 break-all rounded-lg border border-border bg-bg px-2 py-1.5 text-[11px] text-fg">
          {link}
        </p>
      ) : null}
      {msg ? <p className={`mt-2 text-[12px] ${ok ? "text-success" : "text-danger"}`}>{msg}</p> : null}
    </section>
  );
}
