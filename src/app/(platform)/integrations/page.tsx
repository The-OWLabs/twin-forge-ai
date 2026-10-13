"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, CircleSlash, Cloud, Database, FileText, KeyRound, Loader2, PlugZap, Radio, Server, Sparkles, XCircle, HardDrive, Cpu, ScanEye } from "lucide-react";
import { PageHeader } from "@/components/page";
import { Badge, Button, Card, CardBody, CardHeader, type Tone } from "@/components/ui/primitives";
import { useFactory } from "@/client/store";

interface Integration {
  id: string;
  name: string;
  service: string;
  purpose: string;
  state: "active-simulated" | "not-configured" | "configured-untested" | "connected" | "error";
  detail: string;
  env: { name: string; set: boolean }[];
  fallback: string;
  lastCheckedAt: string | null;
  testable: boolean;
}

const STATE: Record<Integration["state"], { label: string; tone: Tone; Icon: typeof CheckCircle2 }> = {
  connected: { label: "Connected (verified)", tone: "healthy", Icon: CheckCircle2 },
  "active-simulated": { label: "Active · simulated/local", tone: "accent", Icon: Cpu },
  "configured-untested": { label: "Configured · not yet verified", tone: "warning", Icon: KeyRound },
  "not-configured": { label: "Not configured", tone: "neutral", Icon: CircleSlash },
  error: { label: "Connection failed", tone: "critical", Icon: XCircle },
};

const ICON: Record<string, typeof Cloud> = {
  telemetry: Radio,
  "vertex-ai": Sparkles,
  bigquery: Database,
  pubsub: Radio,
  gcs: FileText,
  mqtt: Server,
  persistence: HardDrive,
  "cloud-run": Cloud,
  "vision-service": ScanEye,
};

export default function IntegrationsPage() {
  const toast = useFactory((s) => s.toast);
  const [items, setItems] = useState<Integration[] | null>(null);
  const [testing, setTesting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () =>
    fetch("/api/integrations", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => setItems(d.integrations))
      .catch((e) => setError(String(e)));
  useEffect(() => {
    void load();
  }, []);

  const test = async (id: string) => {
    setTesting(id);
    try {
      const r = await fetch("/api/integrations/test", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) });
      const d = await r.json();
      setItems(d.integrations);
      toast({ tone: d.result.ok ? "success" : "error", title: d.result.ok ? "Connection verified" : "Connection test failed", detail: d.result.detail });
    } catch (e) {
      toast({ tone: "error", title: "Test request failed", detail: String(e) });
    } finally {
      setTesting(null);
    }
  };

  return (
    <div className="animate-fade-in">
      <PageHeader
        title="Integrations & Data Sources"
        description="Google Cloud services are wired through adapters with local fallbacks, so the demo runs without credentials. Status is reported honestly: an integration shows Connected only after a real call succeeds."
        actions={
          <Button size="sm" variant="secondary" onClick={() => load()}>
            <PlugZap className="h-3.5 w-3.5" /> Refresh status
          </Button>
        }
      />
      {error && <p className="mb-3 text-[12px] text-critical-ink">{error}</p>}
      <div className="grid gap-3 lg:grid-cols-2">
        {!items &&
          Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-44 animate-pulse rounded-xl bg-surface" />)}
        {items?.map((i) => {
          const S = STATE[i.state];
          const Icon = ICON[i.id] ?? PlugZap;
          return (
            <Card key={i.id}>
              <CardBody className="pt-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3">
                    <span className="rounded-lg border border-line bg-shell p-2 text-ink-2">
                      <Icon className="h-4 w-4" />
                    </span>
                    <div>
                      <p className="text-[14px] font-semibold text-ink">{i.name}</p>
                      <p className="text-[11.5px] text-muted">
                        {i.service} · {i.purpose}
                      </p>
                    </div>
                  </div>
                  <Badge tone={S.tone}>
                    <S.Icon className="h-3 w-3" /> {S.label}
                  </Badge>
                </div>
                <p className="mt-3 text-[12px] leading-relaxed text-ink-2">{i.detail}</p>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {i.env.map((e) => (
                    <span key={e.name} className={`rounded border px-1.5 py-px font-mono text-[10.5px] ${e.set ? "border-healthy/40 text-healthy-ink" : "border-line text-muted"}`}>
                      {e.name} {e.set ? "✓" : "—"}
                    </span>
                  ))}
                </div>
                <div className="mt-3 flex items-center justify-between gap-2 border-t border-line pt-3">
                  <p className="text-[11px] text-muted">
                    Fallback: {i.fallback}
                    {i.lastCheckedAt && ` · last checked ${new Date(i.lastCheckedAt).toLocaleTimeString()}`}
                  </p>
                  {i.testable && (
                    <Button size="xs" variant="secondary" onClick={() => test(i.id)} disabled={testing !== null}>
                      {testing === i.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <PlugZap className="h-3 w-3" />} Test connection
                    </Button>
                  )}
                </div>
              </CardBody>
            </Card>
          );
        })}
      </div>

      <Card className="mt-4">
        <CardHeader title="Google Cloud architecture" description="How each service maps onto the platform (see README for setup)" icon={<Cloud className="h-4 w-4" />} />
        <CardBody>
          <div className="grid gap-3 text-[12.5px] md:grid-cols-2 xl:grid-cols-3">
            {[
              ["Cloud Run", "Hosts the single Next.js service (UI + API). Container built from the included Dockerfile."],
              ["Vertex AI · Gemini", "Server-side narratives for agent briefings: JSON-schema output, zod validation, timeout, numeric grounding check. Never computes metrics."],
              ["BigQuery", "Dataset for telemetry, production events, health history, scenario outcomes and decisions (infra/bigquery/schema.sql). Scenario runs and decisions are mirrored when configured."],
              ["Pub/Sub", "Telemetry ingestion subscription. With TELEMETRY_SOURCE=pubsub, messages {assetId, vibration, temperature, powerKw} override simulated measurements."],
              ["Cloud Storage", "Per-asset manuals and inspection reports under assets/<assetId>/; local demo documents otherwise."],
              ["Plant model (local)", "Deterministic simulation that always works offline — the source of every number in the demo."],
            ].map(([t, d]) => (
              <div key={t} className="rounded-xl border border-line bg-shell/60 p-3">
                <p className="font-semibold text-ink">{t}</p>
                <p className="mt-1 text-ink-2">{d}</p>
              </div>
            ))}
          </div>
        </CardBody>
      </Card>
    </div>
  );
}
