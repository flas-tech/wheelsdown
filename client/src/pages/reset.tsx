import { useState } from "react";
import { Link, useRoute } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/lib/auth";

export default function ResetPage() {
  const [, params] = useRoute("/reset/:token");
  const { openAuth } = useAuth();
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [state, setState] = useState<"idle" | "busy" | "done">("idle");
  const [err, setErr] = useState("");
  const inputCls = "w-full h-11 rounded-xl border border-input bg-background px-3 text-base sm:text-sm focus:outline-none focus:ring-2 focus:ring-ring";

  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setErr("");
    if (pw.length < 8) return setErr("Password must be at least 8 characters");
    if (pw !== pw2) return setErr("The two passwords don't match");
    setState("busy");
    try {
      await apiRequest("POST", "/api/auth/reset", { token: params?.token, password: pw });
      setState("done");
    } catch (e: any) {
      const m = String(e.message || "").replace(/^\d+:\s*/, "");
      try { setErr(JSON.parse(m).message); } catch { setErr(m || "Something went wrong"); }
      setState("idle");
    }
  };

  if (state === "done")
    return (
      <div className="max-w-sm mx-auto space-y-4 pt-6 text-center" data-testid="section-reset-done">
        <h1 className="text-lg font-semibold">Password updated</h1>
        <p className="text-sm text-muted-foreground">For safety, you've been signed out on every device. Sign in with your new password.</p>
        <button onClick={() => openAuth()} className="h-11 px-6 rounded-full taxi-sign font-semibold hover-elevate" data-testid="button-reset-signin">Sign in</button>
      </div>
    );

  return (
    <form onSubmit={submit} className="max-w-sm mx-auto space-y-3 pt-6" data-testid="form-reset">
      <h1 className="text-lg font-semibold">Choose a new password</h1>
      <input type="password" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="New password (8+ characters)" autoComplete="new-password" className={inputCls} data-testid="input-reset-password" />
      <input type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} placeholder="Repeat new password" autoComplete="new-password" className={inputCls} data-testid="input-reset-password2" />
      {err && <p className="text-sm text-destructive" data-testid="text-reset-error">{err}</p>}
      <button disabled={state === "busy"} className="w-full h-11 rounded-full taxi-sign font-semibold hover-elevate disabled:opacity-50" data-testid="button-reset-submit">
        {state === "busy" ? "Saving…" : "Save new password"}
      </button>
      <p className="text-xs text-muted-foreground">Link expired? <Link href="/" className="underline">Go home</Link> and use "Forgot password?" to get a new one.</p>
    </form>
  );
}
