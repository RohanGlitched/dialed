export type Issue = { code: string; level: "block" | "warn"; text: string; deg?: number };
export type Outcome = "logged" | "reshoot" | "held" | "mismatch";

export type Gauge = {
  id: string;
  name: string;
  service: string;
  unit: string;
  min: number;
  max: number;
  normal: [number, number];
  alarm: { low: number | null; high: number | null };
  drift_per_day?: number;
  pos: [number, number];
  pair?: { with: string; role: "inlet" | "outlet"; across: string; dp_limit: number };
  enrolled?: { start: number; sweep: number; gap: number; from: string };
};

export type Step =
  | { kind: "tool"; name: string; args: Record<string, unknown>; result: Record<string, unknown>; ms: number }
  | { kind: "model"; model: string; text: string; calls: string[]; ms: number }
  | { kind: "note"; text: string }
  | { kind: "done"; outcome: Outcome; ms: number };

export type Reading = {
  id: string;
  gauge: string;
  at: string;
  outcome: Outcome;
  value: number | null;
  read_value: number | null;
  unit: string;
  confidence: number | null;
  message: string;
  engine: string | null;
  images: Record<string, string>;
  order: string | null;
  seeded: boolean;
  issues: Issue[];
  tool_calls?: number;
  inspect?: string | null;
  assessment?: Assessment | null;
  steps?: Step[];
};

export type Breach = { code: string; text: string; severity: "urgent" | "high" | "medium" };
export type Assessment = {
  value: number;
  unit: string;
  normal: [number, number];
  breaches: Breach[];
  last?: { value: number; at: string; days_ago: number };
  delta?: number;
  rate_per_day?: number;
  zscore?: number | null;
  related?: { across: string; with: string; dp: number; limit: number; unit: string };
};

export type Order = {
  id: string;
  gauge: string;
  gauge_name: string;
  reading: string;
  at: string;
  status: "held" | "approved" | "rejected";
  title: string;
  reason: string;
  priority: "urgent" | "high" | "medium";
  breaches: Breach[];
  struck: string[];
  value: number;
  unit: string;
  evidence: Record<string, string>;
  engine: string;
  decided_at?: string;
  decided_by?: string;
  note?: string;
};

export type RoundGauge = Gauge & { latest: Reading | null; recent: { at: string; value: number }[] };
export type RoundData = { round: { id: string; name: string; site: string; shift: string; gauges: string[] }; gauges: RoundGauge[]; held: Order[] };

/** /api/read: the reader's full trace. */
export type Inspect = {
  reading: {
    ok: boolean;
    value: number | null;
    unit: string | null;
    min: number | null;
    max: number | null;
    confidence: number;
    needle_angle: number | null;
    tilt: number | null;
    issues: Issue[];
    numbers: { value: number; deg: number; box: [number, number, number, number] }[];
    timings: Record<string, number>;
    features: Record<string, number>;
  };
  geometry: {
    photo: [number, number] | null;
    scale_to_photo: number;
    candidates: { ellipse: [number, number, number, number, number]; score: number }[];
    dial_size: number;
    rad: number;
    ellipse?: [number, number, number, number, number];
    M?: [[number, number, number], [number, number, number]];
    center?: [number, number];
    ring?: [number, number];
    gap?: number;
    face_edge?: number;
    ticks?: { deg: number; inner: number }[];
    tick_lines?: { p: [number, number]; d: [number, number]; len: number }[];
    needle_profile?: number[];
    text?: { text: string; box: [number, number, number, number]; deg: number; r: number; number: boolean; used: boolean }[];
    fit?: { points: { deg: number; value: number }[]; curve: { from_gap: number; deg: number; value: number }[] };
  };
  images?: Partial<Record<"photo" | "edges" | "dial" | "face" | "ink", string>>;
};
