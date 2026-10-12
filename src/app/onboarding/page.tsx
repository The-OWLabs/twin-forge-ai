"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, Bot, Camera, Check, Cloud, Cpu, Factory, Hammer, MapPin, Package, Rows3, Server, Sparkles, Tag, Wand2 } from "lucide-react";
import { useFactory } from "@/client/store";
import { BrandMark, BrandName } from "@/components/brand";
import { Toaster } from "@/components/shell/toaster";
import { ThemeToggle } from "@/components/theme-toggle";
import { Badge, Button, Input, Label, Select, Switch, TooltipProvider } from "@/components/ui/primitives";
import type { AssetKind, DataSourceKind } from "@/domain/types";
import { cn } from "@/lib/cn";

const STEPS = ["Factory", "Location", "Lines", "Assets", "Data source", "Review"] as const;
const KINDS: { kind: AssetKind; label: string; icon: typeof Bot; desc: string }[] = [
  { kind: "conveyor", label: "Conveyor", icon: Rows3, desc: "Infeed / transfer motors" },
  { kind: "press", label: "Industrial press", icon: Hammer, desc: "Press-fit stations" },
  { kind: "robot", label: "Assembly robot", icon: Bot, desc: "Six-axis assembly cells" },
  { kind: "camera", label: "Inspection camera", icon: Camera, desc: "Inline AOI vision" },
];
const PRODUCTS = ["EdgeController ECU-200", "SensorHub SH-40", "Gateway GW-10"];

interface IntegrationLite {
  id: string;
  state: string;
  detail: string;
}

export default function OnboardingPage() {
  const router = useRouter();
  const createFactory = useFactory((s) => s.createFactory);
  const reset = useFactory((s) => s.reset);
  const busy = useFactory((s) => s.busy);
  const [step, setStep] = useState(0);
  const [form, setForm] = useState({
    name: "Northgate Electronics — Plant 1",
    industry: "Electronics manufacturing",
    location: "Austin, Texas",
    productionType: "PCB assembly & packaging",
    assemblyLines: 2,
    assetKinds: ["conveyor", "press", "robot", "camera"] as AssetKind[],
    dataSource: "demo" as DataSourceKind,
    seedIncident: true,
  });
  const [integrations, setIntegrations] = useState<IntegrationLite[] | null>(null);
  useEffect(() => {
    fetch("/api/integrations", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => setIntegrations(d.integrations))
      .catch(() => setIntegrations([]));
  }, []);
  const status = (id: string) => integrations?.find((i) => i.id === id);
  const mqttOk = status("mqtt")?.state === "connected";
  const cloudOk = status("pubsub")?.state === "connected";

  const valid = useMemo(() => {
    if (step === 0) return form.name.trim().length >= 2 && form.industry.trim().length >= 2;
    if (step === 1) return form.location.trim().length >= 2 && form.productionType.trim().length >= 2;
    if (step === 3) return form.assetKinds.length > 0;
    return true;
  }, [step, form]);

  const create = async () => {
    if (await createFactory(form)) router.push("/dashboard");
  };
  const loadDemo = async () => {
    await reset();
    router.push("/dashboard");
  };
  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));

  return (
    <TooltipProvider>
      <div className="min-h-screen bg-canvas">
        <div className="pointer-events-none fixed inset-0 grid-bg [mask-image:radial-gradient(ellipse_at_top,black_30%,transparent_70%)]" aria-hidden />
        <header className="relative mx-auto flex h-16 max-w-5xl items-center justify-between px-4">
          <Link href="/" className="flex items-center gap-2.5">
            <BrandMark />
            <BrandName className="text-[15px]" />
          </Link>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <Button size="sm" variant="secondary" onClick={loadDemo} loading={busy.reset}>
              <Wand2 className="h-3.5 w-3.5" /> Load preconfigured demo factory
            </Button>
          </div>
        </header>
        <main className="relative mx-auto max-w-5xl px-4 pt-6 pb-16">
          <h1 className="text-[28px] font-semibold tracking-tight text-ink">Create your factory&apos;s digital twin</h1>
          <p className="mt-1 text-[14px] text-muted">Six short steps. The twin is generated from templates and simulated telemetry starts immediately — no credentials required.</p>

          <ol className="mt-6 grid grid-cols-3 gap-2 md:grid-cols-6">
            {STEPS.map((s, i) => (
              <li key={s}>
                <button
                  onClick={() => i < step && setStep(i)}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-lg border px-2.5 py-2 text-left text-[12px] transition-colors",
                    i === step ? "border-accent/60 bg-accent/10 text-ink" : i < step ? "border-healthy/40 text-ink-2 hover:bg-surface" : "border-line text-muted",
                  )}
                >
                  <span className={cn("flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10.5px] font-semibold", i < step ? "bg-healthy text-white" : i === step ? "bg-accent text-white" : "bg-surface-3 text-muted")}>
                    {i < step ? <Check className="h-3 w-3" /> : i + 1}
                  </span>
                  {s}
                </button>
              </li>
            ))}
          </ol>

          <div className="mt-5 rounded-2xl border border-line bg-surface p-6 shadow-[var(--shadow-card)]">
            {step === 0 && (
              <div className="grid gap-5 md:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="f-name">Factory name</Label>
                  <Input id="f-name" value={form.name} onChange={(e) => set({ name: e.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="f-ind">Industry</Label>
                  <Select id="f-ind" className="w-full" value={form.industry} onChange={(e) => set({ industry: e.target.value })}>
                    {["Electronics manufacturing", "Automotive components", "Industrial equipment", "Consumer electronics", "Medical devices"].map((x) => (
                      <option key={x}>{x}</option>
                    ))}
                  </Select>
                </div>
                <p className="text-[12.5px] text-muted md:col-span-2">
                  The MVP ships with electronics-assembly templates (assembly lines feeding a packaging line). Other industries reuse the same templates for now.
                </p>
              </div>
            )}
            {step === 1 && (
              <div className="grid gap-5 md:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="f-loc">Location</Label>
                  <div className="relative">
                    <MapPin className="pointer-events-none absolute top-2.5 left-3 h-4 w-4 text-muted" />
                    <Input id="f-loc" className="pl-9" value={form.location} onChange={(e) => set({ location: e.target.value })} />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="f-type">Production type</Label>
                  <Input id="f-type" value={form.productionType} onChange={(e) => set({ productionType: e.target.value })} />
                </div>
              </div>
            )}
            {step === 2 && (
              <div className="space-y-5">
                <div>
                  <Label>Assembly lines</Label>
                  <div className="mt-2 flex gap-2">
                    {[1, 2, 3].map((n) => (
                      <button
                        key={n}
                        onClick={() => set({ assemblyLines: n })}
                        className={cn("h-11 w-16 rounded-xl border text-[15px] font-semibold", form.assemblyLines === n ? "border-accent bg-accent/15 text-ink" : "border-line text-ink-2 hover:bg-surface-2")}
                      >
                        {n}
                      </button>
                    ))}
                  </div>
                  <p className="mt-2 text-[12px] text-muted">A packaging line is always added downstream. Total production lines: {form.assemblyLines + 1}.</p>
                </div>
                <div className="grid gap-2 md:grid-cols-2">
                  {Array.from({ length: form.assemblyLines }).map((_, i) => (
                    <div key={i} className="flex items-center gap-3 rounded-xl border border-line bg-shell/60 p-3">
                      <Factory className="h-4 w-4 text-accent" />
                      <div>
                        <p className="text-[13px] font-semibold text-ink">Assembly Line {String.fromCharCode(65 + i)}</p>
                        <p className="text-[11.5px] text-muted">Primary product: {PRODUCTS[i]}</p>
                      </div>
                    </div>
                  ))}
                  <div className="flex items-center gap-3 rounded-xl border border-line bg-shell/60 p-3">
                    <Package className="h-4 w-4 text-series-3" />
                    <div>
                      <p className="text-[13px] font-semibold text-ink">Packaging Line {String.fromCharCode(65 + form.assemblyLines)}</p>
                      <p className="text-[11.5px] text-muted">Merge conveyor, carton packer, label &amp; seal, final inspection</p>
                    </div>
                  </div>
                </div>
              </div>
            )}
            {step === 3 && (
              <div>
                <Label>Machines on each assembly line (in flow order)</Label>
                <div className="mt-3 grid gap-3 md:grid-cols-4">
                  {KINDS.map((k) => {
                    const on = form.assetKinds.includes(k.kind);
                    return (
                      <button
                        key={k.kind}
                        onClick={() => set({ assetKinds: on ? form.assetKinds.filter((x) => x !== k.kind) : KINDS.map((x) => x.kind).filter((x) => x === k.kind || form.assetKinds.includes(x)) })}
                        className={cn("rounded-xl border p-4 text-left transition-colors", on ? "border-accent/60 bg-accent/10" : "border-line hover:bg-surface-2")}
                        aria-pressed={on}
                      >
                        <div className="flex items-center justify-between">
                          <k.icon className={cn("h-5 w-5", on ? "text-accent" : "text-muted")} />
                          {on && <Check className="h-4 w-4 text-accent" />}
                        </div>
                        <p className="mt-3 text-[13.5px] font-semibold text-ink">{k.label}</p>
                        <p className="text-[11.5px] text-muted">{k.desc}</p>
                      </button>
                    );
                  })}
                </div>
                <p className="mt-3 text-[12px] text-muted">
                  {form.assemblyLines * form.assetKinds.length + 4} machines will be created with sensors, thresholds, power ratings and maintenance history. You can add or edit assets later in the Twin Studio.
                </p>
              </div>
            )}
            {step === 4 && (
              <div className="grid gap-3 md:grid-cols-3">
                {[
                  { id: "demo" as const, icon: Cpu, title: "Demo data", body: "Deterministic simulated telemetry from the plant model. Works immediately.", state: { tone: "healthy" as const, text: "Ready" } },
                  {
                    id: "mqtt" as const,
                    icon: Server,
                    title: "MQTT broker",
                    body: status("mqtt")?.detail ?? "Checking configuration…",
                    state: mqttOk ? { tone: "healthy" as const, text: "Reachable" } : status("mqtt")?.state === "not-configured" ? { tone: "neutral" as const, text: "Not configured" } : { tone: "warning" as const, text: "Configured · unverified" },
                  },
                  {
                    id: "cloud" as const,
                    icon: Cloud,
                    title: "Cloud integration",
                    body: status("pubsub")?.detail ?? "Checking configuration…",
                    state: cloudOk ? { tone: "healthy" as const, text: "Connected" } : status("pubsub")?.state === "not-configured" ? { tone: "neutral" as const, text: "Not configured" } : { tone: "warning" as const, text: "Configured · unverified" },
                  },
                ].map((o) => (
                  <button
                    key={o.id}
                    onClick={() => set({ dataSource: o.id })}
                    className={cn("rounded-xl border p-4 text-left transition-colors", form.dataSource === o.id ? "border-accent/60 bg-accent/10" : "border-line hover:bg-surface-2")}
                  >
                    <div className="flex items-center justify-between">
                      <o.icon className="h-5 w-5 text-ink-2" />
                      <Badge tone={o.state.tone}>{o.state.text}</Badge>
                    </div>
                    <p className="mt-3 text-[13.5px] font-semibold text-ink">{o.title}</p>
                    <p className="mt-1 text-[11.5px] leading-relaxed text-muted">{o.body}</p>
                  </button>
                ))}
                {form.dataSource !== "demo" && (
                  <p className="rounded-lg border border-warning/40 bg-warning/8 p-3 text-[12px] text-ink-2 md:col-span-3">
                    {form.dataSource === "mqtt" ? "MQTT ingestion is not implemented in this MVP" : "Pub/Sub ingestion requires GOOGLE_CLOUD_PROJECT, PUBSUB_TELEMETRY_SUBSCRIPTION and TELEMETRY_SOURCE=pubsub"}. The twin will be created with simulated telemetry and the selected source recorded — it will not be reported as connected.
                  </p>
                )}
              </div>
            )}
            {step === 5 && (
              <div className="grid gap-6 md:grid-cols-2">
                <dl className="space-y-2 text-[13px]">
                  {[
                    ["Factory", form.name],
                    ["Industry", form.industry],
                    ["Location", form.location],
                    ["Production", form.productionType],
                    ["Lines", `${form.assemblyLines} assembly + 1 packaging`],
                    ["Machines per assembly line", form.assetKinds.join(", ")],
                    ["Data source", form.dataSource === "demo" ? "Demo data (simulated)" : `${form.dataSource.toUpperCase()} selected — simulated until connected`],
                  ].map(([k, v]) => (
                    <div key={k} className="flex justify-between gap-4 border-b border-line/60 pb-2">
                      <dt className="text-muted">{k}</dt>
                      <dd className="text-right font-medium text-ink">{v}</dd>
                    </div>
                  ))}
                </dl>
                <div className="space-y-4">
                  <label className="flex items-start justify-between gap-3 rounded-xl border border-line bg-shell/60 p-4">
                    <span>
                      <span className="block text-[13.5px] font-semibold text-ink">Seed a demo incident</span>
                      <span className="mt-0.5 block text-[12px] text-muted">Start one robot on a developing bearing-wear trend so the agents and simulator have something to investigate.</span>
                    </span>
                    <Switch checked={form.seedIncident} onCheckedChange={(v) => set({ seedIncident: v })} />
                  </label>
                  <p className="text-[12px] text-muted">Creating a twin replaces the current factory state (single-tenant MVP). You can restore the demo factory at any time from Demo controls.</p>
                </div>
              </div>
            )}

            <div className="mt-8 flex items-center justify-between border-t border-line pt-5">
              <Button variant="ghost" size="sm" onClick={() => setStep(Math.max(0, step - 1))} disabled={step === 0}>
                <ArrowLeft className="h-3.5 w-3.5" /> Back
              </Button>
              {step < STEPS.length - 1 ? (
                <Button variant="primary" size="sm" onClick={() => setStep(step + 1)} disabled={!valid}>
                  Continue <ArrowRight className="h-3.5 w-3.5" />
                </Button>
              ) : (
                <Button variant="primary" size="sm" onClick={create} loading={busy.create}>
                  <Sparkles className="h-3.5 w-3.5" /> Create digital twin
                </Button>
              )}
            </div>
          </div>
          <p className="mt-4 text-center text-[12px] text-muted">
            <Tag className="mr-1 inline h-3 w-3" /> Prefer the scripted scenario? <button onClick={loadDemo} className="text-accent hover:underline">Load the Aurora Electronics demo factory</button>.
          </p>
        </main>
        <Toaster />
      </div>
    </TooltipProvider>
  );
}
