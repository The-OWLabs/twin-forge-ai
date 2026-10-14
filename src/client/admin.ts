"use client";

import { create } from "zustand";

export type AdminMode = "passcode" | "open-local" | "locked";

interface AdminStore {
  admin: boolean;
  mode: AdminMode | null;
  loaded: boolean;
  load: () => Promise<void>;
  signIn: (passcode: string) => Promise<string | null>;
  signOut: () => Promise<void>;
}

/** Admin session state. The server is the authority: every admin API checks the session cookie itself. */
export const useAdmin = create<AdminStore>((set) => ({
  admin: false,
  mode: null,
  loaded: false,
  load: async () => {
    try {
      const r = await fetch("/api/admin/session", { cache: "no-store" });
      const d = (await r.json()) as { admin: boolean; mode: AdminMode };
      set({ admin: d.admin, mode: d.mode, loaded: true });
    } catch {
      set({ loaded: true });
    }
  },
  signIn: async (passcode) => {
    const r = await fetch("/api/admin/session", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ passcode }), cache: "no-store" });
    const d = (await r.json().catch(() => ({}))) as { admin?: boolean; mode?: AdminMode; error?: string };
    if (!r.ok) return d.error ?? `Sign-in failed (${r.status})`;
    set({ admin: !!d.admin, mode: d.mode ?? null, loaded: true });
    return null;
  },
  signOut: async () => {
    const r = await fetch("/api/admin/session", { method: "DELETE", cache: "no-store" });
    const d = (await r.json().catch(() => ({}))) as { admin?: boolean; mode?: AdminMode };
    set({ admin: !!d.admin, mode: d.mode ?? null });
  },
}));
