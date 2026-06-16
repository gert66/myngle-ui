export type Row = Record<string, unknown>;

const BLANK = new Set(["", "nan", "none", "null", "undefined", "n/a", "na"]);

export function isBlank(v: unknown): boolean {
  if (v === null || v === undefined) return true;
  if (typeof v === "number") return Number.isNaN(v);
  const s = String(v).trim();
  if (!s) return true;
  return BLANK.has(s.toLowerCase());
}

export function val(row: Row, ...keys: string[]): string {
  for (const k of keys) {
    const v = row[k];
    if (!isBlank(v)) return String(v).trim();
    // case-insensitive lookup
    const lk = k.toLowerCase();
    for (const rk of Object.keys(row)) {
      if (rk.toLowerCase() === lk && !isBlank(row[rk])) return String(row[rk]).trim();
    }
  }
  return "";
}

export function num(row: Row, key: string): number | null {
  const v = row[key];
  if (isBlank(v)) return null;
  const n = typeof v === "number" ? v : parseFloat(String(v).replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

export function bool(row: Row, key: string): boolean {
  const v = row[key];
  if (isBlank(v)) return false;
  const s = String(v).trim().toLowerCase();
  return s === "true" || s === "1" || s === "yes" || s === "y";
}

const URL_RE = /\bhttps?:\/\/[^\s<>"'|,]+/gi;

export function extractUrls(s: string): string[] {
  if (!s) return [];
  const matches = s.match(URL_RE) || [];
  // also split by common separators
  const extra = s.split(/[\s|;]+/).filter((p) => /^https?:\/\//i.test(p));
  return Array.from(new Set([...matches, ...extra].map((u) => u.replace(/[.,;:]+$/, ""))));
}

export function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export function cleanTier(s: string): string {
  // strip emoji prefixes like "賂 Warm"
  return s.replace(/^[^A-Za-z]+/, "").trim() || s;
}

export function tierKind(tier: string): "warm" | "hot" | "pass" | "neutral" {
  const t = cleanTier(tier).toLowerCase();
  if (t.includes("hot")) return "hot";
  if (t.includes("warm")) return "warm";
  if (t.includes("pass") || t.includes("cold") || t.includes("low")) return "pass";
  return "neutral";
}

export function splitList(s: string): string[] {
  if (!s) return [];
  return s
    .split(/\r?\n|\||;|,(?=\s*[A-Za-z])/)
    .map((x) => x.trim())
    .filter((x) => x && !BLANK.has(x.toLowerCase()));
}

export interface SnippetCard {
  index: string;
  queryType: string;
  query: string;
  rank: string;
  title: string;
  url: string;
  sourceDomain: string;
  text: string;
}

export function extractGoogleSnippets(row: Row): SnippetCard[] {
  const out: SnippetCard[] = [];
  const indices = new Set<string>();
  for (const k of Object.keys(row)) {
    const m = k.match(/^google_snippet_(\d+)_/i);
    if (m) indices.add(m[1]);
  }
  const sorted = Array.from(indices).sort();
  for (const i of sorted) {
    const get = (suf: string) => val(row, `google_snippet_${i}_${suf}`);
    const c: SnippetCard = {
      index: i,
      queryType: get("query_type"),
      query: get("query"),
      rank: get("rank"),
      title: get("title"),
      url: get("url"),
      sourceDomain: get("source_domain"),
      text: get("text"),
    };
    if (c.title || c.url || c.text) out.push(c);
  }
  return out;
}

export function tryParseJson(s: string): unknown {
  if (!s) return null;
  try {
    return JSON.parse(s);
  } catch {
    // try to extract first JSON object/array
    const m = s.match(/[\[{][\s\S]*[\]}]/);
    if (m) {
      try { return JSON.parse(m[0]); } catch { return null; }
    }
    return null;
  }
}

export interface ParsedEvidence {
  queryType?: string;
  query?: string;
  rank?: string | number;
  title?: string;
  url?: string;
  sourceDomain?: string;
  snippet?: string;
}

export function normalizeParsedEvidence(parsed: unknown): ParsedEvidence[] {
  const items: ParsedEvidence[] = [];
  const visit = (node: unknown) => {
    if (!node) return;
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    if (typeof node === "object") {
      const o = node as Record<string, unknown>;
      const hasField = ["url", "link", "title", "snippet", "text"].some((k) => o[k]);
      if (hasField) {
        items.push({
          queryType: (o.query_type as string) || (o.queryType as string),
          query: o.query as string,
          rank: (o.rank as number | string) ?? (o.position as number | string),
          title: (o.title as string) || (o.name as string),
          url: (o.url as string) || (o.link as string),
          sourceDomain: (o.source_domain as string) || (o.sourceDomain as string) || (o.displayLink as string),
          snippet: (o.snippet as string) || (o.text as string) || (o.description as string),
        });
      }
      Object.values(o).forEach(visit);
    }
  };
  visit(parsed);
  return items;
}

export interface SignalScore {
  key: string;
  label: string;
  score: number;
}

const SIGNAL_LABELS: Record<string, string> = {
  sig_intl_footprint_score: "Intl footprint",
  sig_foreign_hq_score: "Foreign HQ",
  sig_explicit_lnd_score: "Explicit L&D",
  sig_multicultural_score: "Multicultural",
  sig_employer_branding_score: "Employer branding",
  sig_rapid_growth_score: "Rapid growth",
  sig_merger_acq_score: "M&A",
  sig_lnd_onboarding_score: "L&D onboarding",
  ti_language_english_score: "English",
  ti_onboarding_score: "Onboarding",
  ti_leadership_score: "Leadership",
  ti_intercultural_score: "Intercultural",
  ti_negotiation_sales_score: "Negotiation / sales",
  ti_broader_professional_score: "Broader professional",
  ti_team_collab_score: "Team collab",
};

export function getSignalScores(row: Row): SignalScore[] {
  const out: SignalScore[] = [];
  for (const [k, label] of Object.entries(SIGNAL_LABELS)) {
    const n = num(row, k);
    if (n !== null) out.push({ key: k, label, score: n });
  }
  return out;
}

export function safeText(v: unknown): string {
  if (isBlank(v)) return "—";
  return String(v).trim();
}

// Human-readable mapping for chips/prose. Keys match SIGNAL_LABELS.
const HUMAN_SIGNAL_LABELS: Record<string, string> = {
  sig_intl_footprint_score: "International footprint",
  sig_foreign_hq_score: "Foreign HQ",
  sig_explicit_lnd_score: "Active learning & development",
  sig_multicultural_score: "Multicultural workforce",
  sig_employer_branding_score: "Strong employer branding",
  sig_rapid_growth_score: "Rapid growth",
  sig_merger_acq_score: "Recent M&A activity",
  sig_lnd_onboarding_score: "Onboarding programs",
  ti_language_english_score: "English language training need",
  ti_onboarding_score: "Onboarding training need",
  ti_leadership_score: "Leadership training need",
  ti_intercultural_score: "Intercultural training need",
  ti_negotiation_sales_score: "Sales & negotiation training need",
  ti_broader_professional_score: "Broader professional training",
  ti_team_collab_score: "Team collaboration training",
};

export function humanSignalLabel(key: string): string {
  return HUMAN_SIGNAL_LABELS[key] || key.replace(/^(sig_|ti_)/, "").replace(/_score$/, "").replace(/_/g, " ");
}

export interface FriendlySignals {
  positiveChips: string[];
  weakChips: string[];
  prose: string;
}

export function buildFriendlySignals(row: Row): FriendlySignals {
  const sigs = getSignalScores(row);
  const positives = sigs.filter((s) => s.score >= 2);
  const weaks = sigs.filter((s) => s.score <= 1);
  const country = val(row, "country");

  const positiveChips = positives.map((s) => humanSignalLabel(s.key));
  if (country && !positiveChips.some((c) => c.toLowerCase().includes(country.toLowerCase()))) {
    positiveChips.push(`${country} presence`);
  }
  const weakChips = weaks.map((s) => humanSignalLabel(s.key));

  let prose = "";
  if (positives.length) {
    const labels = positives.map((s) => humanSignalLabel(s.key).toLowerCase());
    const joined =
      labels.length === 1
        ? labels[0]
        : labels.slice(0, -1).join(", ") + " and " + labels[labels.length - 1];
    prose = `This company shows several signals that may make it relevant for mYngle: ${joined}.`;
  }

  return { positiveChips, weakChips, prose };
}

function joinList(items: string[]): string {
  if (items.length === 1) return items[0];
  return items.slice(0, -1).join(", ") + " and " + items[items.length - 1];
}

export function buildHotExplanation(row: Row): string {
  const sigs = getSignalScores(row).filter((s) => s.score >= 2);
  const labels = sigs.map((s) => humanSignalLabel(s.key).toLowerCase());
  if (!labels.length) return "No clear positive signal found in the available evidence.";
  const joined = joinList(labels.slice(0, 4));
  return `The strongest signals are ${joined}. These suggest the company may have cross-border teams or employee development needs, but the caller should still verify whether language or communication training is currently relevant.`;
}

export function buildNotHotExplanation(row: Row): string {
  const sigs = getSignalScores(row);
  const weak = sigs.filter((s) => s.score <= 1).map((s) => humanSignalLabel(s.key).toLowerCase());
  const gaps = val(row, "gaps_missing_signals");
  if (!weak.length && !gaps) {
    return "No major missing signal detected in the available evidence.";
  }
  if (!weak.length) {
    return "Some buying signals are weak or missing in the available evidence. The caller should check whether there is a current training trigger before outreach.";
  }
  const joined = joinList(weak.slice(0, 4));
  return `The weaker signals are around ${joined}. This means the company may fit mYngle's profile, but the caller should not assume an active training need without checking.`;
}

export function isHighScoreRecord(row: Row): boolean {
  const score = num(row, "commercial_fit_score");
  if (score === null) return false;
  return score > 9.7;
}

export function buildCallStarter(row: Row): string {
  const name = val(row, "company_name") || "this company";
  const buyer = val(row, "icp_potential_buyer_function", "buyer_function", "buyer_route") || "HR or L&D";
  const tier = cleanTier(val(row, "commercial_tier")).toLowerCase();
  const readiness = val(row, "outreach_readiness_status").toLowerCase();

  if (tier.includes("pass") || readiness.includes("low")) {
    return `Note for ${name}: low priority based on current scoring. Only use after manual research confirms a current training trigger. Then ask for ${buyer}.`;
  }

  const { positiveChips } = buildFriendlySignals(row);
  let signalText = "an international or multicultural footprint";
  if (positiveChips.length) {
    const labels = positiveChips.slice(0, 3).map((s) => s.toLowerCase());
    signalText =
      labels.length === 1
        ? labels[0]
        : labels.slice(0, -1).join(", ") + " and " + labels[labels.length - 1];
  }
  return `Hi, I saw that ${name} appears to have ${signalText}. I am calling because mYngle helps international teams with language and communication training. Is ${buyer} the right team to speak with about this?`;
}

export function buildCallerPrepText(row: Row): string {
  const get = (k: string) => safeText(row[k]);
  const lines: string[] = [];
  lines.push(`mYngle Caller Prep — ${get("company_name")}`);
  lines.push("=".repeat(60));
  lines.push(`Domain: ${get("domain")}`);
  lines.push(`Country: ${get("country")}    Industry: ${get("industry")}`);
  lines.push(`Employees: ${get("employee_range")}`);
  lines.push(`Score: ${get("commercial_fit_score")}   Tier: ${cleanTier(get("commercial_tier"))}`);
  lines.push(`Readiness: ${get("outreach_readiness_status")}`);
  lines.push("");
  lines.push("WHY RELEVANT");
  lines.push(safeText(val(row, "icp_why_relevant", "raw_evidence_summary")));
  lines.push("");
  lines.push("WHAT'S HOT");
  lines.push(safeText(val(row, "top_positive_signals")));
  lines.push("");
  lines.push("GAPS");
  lines.push(safeText(val(row, "gaps_missing_signals")));
  lines.push("");
  lines.push("EVIDENCE");
  lines.push(safeText(val(row, "icp_evidence", "raw_evidence_summary")));
  lines.push("");
  lines.push("CALLER ANGLE");
  lines.push(safeText(val(row, "caller_angle")));
  lines.push("");
  lines.push("CALL STARTER");
  lines.push(buildCallStarter(row));
  return lines.join("\n");
}

export interface KeyLink {
  url: string;
  domain: string;
  label: string;
  warn?: boolean;
}

const HR_RE = /careers?|jobs?|people|hr|talent|recruit/i;
const LND_RE = /academy|learning|training|onboard|develop|l-?and-?d|l-?n-?d/i;
const OFFICES_RE = /office|location|global|world|presence|international/i;

export function buildKeyLinks(row: Row): KeyLink[] {
  const links: KeyLink[] = [];
  const seen = new Set<string>();
  const push = (url: string, label: string, warn = false) => {
    if (!url) return;
    const clean = url.trim();
    if (!/^https?:\/\//i.test(clean)) return;
    if (seen.has(clean)) return;
    seen.add(clean);
    links.push({ url: clean, domain: domainOf(clean), label, warn });
  };

  push(val(row, "canonical_company_url"), "Official website");

  // Gather all evidence URLs
  const pools: string[] = [];
  for (const k of ["evidence_source_urls", "serper_source_urls", "raw_google_evidence_urls"]) {
    const v = val(row, k);
    if (v) pools.push(...extractUrls(v));
  }
  // snippet URLs
  for (const snip of extractGoogleSnippets(row)) {
    if (snip.url) pools.push(snip.url);
  }

  const allUrls = Array.from(new Set(pools));

  // LinkedIn
  const li = allUrls.find((u) => /linkedin\.com\/company/i.test(u));
  if (li) push(li, "LinkedIn");

  // Careers/HR
  const hr = allUrls.find((u) => HR_RE.test(u));
  if (hr) push(hr, "Careers / People");

  // L&D
  const lnd = allUrls.find((u) => LND_RE.test(u));
  if (lnd) push(lnd, "Training / L&D");

  // Offices
  const off = allUrls.find((u) => OFFICES_RE.test(u));
  if (off) push(off, "Offices / Locations");

  // Fill remaining with other evidence
  for (const u of allUrls) {
    if (links.length >= 7) break;
    push(u, "Evidence");
  }

  // Competitor (with warning)
  const comp = val(row, "competitor_evidence_url") || val(row, "competitor_attention_url");
  if (comp) push(comp, "Competitor mention — Verify before outreach", true);

  return links.slice(0, 8);
}
