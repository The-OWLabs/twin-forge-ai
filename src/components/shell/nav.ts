import {
  Activity,
  BrainCircuit,
  ClipboardCheck,
  Gauge,
  History,
  Leaf,
  Network,
  PlugZap,
  Boxes,
  FlaskConical,
} from "lucide-react";

export const NAV = [
  {
    section: "Operate",
    items: [
      { href: "/dashboard", label: "Command Center", icon: Gauge },
      { href: "/twin", label: "Digital Twin Studio", icon: Network },
      { href: "/assets", label: "Assets", icon: Boxes },
    ],
  },
  {
    section: "Intelligence",
    items: [
      { href: "/agents", label: "AI Operations", icon: BrainCircuit },
      { href: "/simulator", label: "What-If Simulator", icon: FlaskConical },
      { href: "/approvals", label: "Approvals", icon: ClipboardCheck },
    ],
  },
  {
    section: "Insight",
    items: [
      { href: "/sustainability", label: "Sustainability", icon: Leaf },
      { href: "/audit", label: "Audit Trail", icon: History },
      { href: "/integrations", label: "Integrations", icon: PlugZap },
    ],
  },
] as const;

export const BRAND_ICON = Activity;
