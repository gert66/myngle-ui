import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
import logo from "@/assets/myngle-logo.png";
import {
  Row,
  val,
  num,
  bool,
  isBlank,
  safeText,
  cleanTier,
  tierKind,
  extractUrls,
  extractGoogleSnippets,
  tryParseJson,
  normalizeParsedEvidence,
  getSignalScores,
  buildCallStarter,
  buildCallerPrepText,
  buildKeyLinks,
  buildFriendlySignals,
  buildHotExplanation,
  buildNotHotExplanation,
} from "@/lib/caller-prep";
import { LushaContacts } from "@/components/LushaContacts";

// ---------- Industry grouping (deterministic keyword match) ----------
const INDUSTRY_GROUPS: { group: string; keywords: string[] }[] = [
  { group: "Technology", keywords: ["software", "saas", "tech", "it ", "information technology", "internet", "computer", "data", "cloud", "cyber", "ai", "digital"] },
  { group: "Manufacturing", keywords: ["manufactur", "industrial", "machinery", "automotive", "aerospace", "chemical", "plastics", "steel", "factory"] },
  { group: "Logistics & Transport", keywords: ["logistic", "transport", "shipping", "freight", "supply chain", "warehous", "maritime", "aviation", "airline", "rail"] },
  { group: "Healthcare", keywords: ["health", "pharma", "biotech", "medical", "hospital", "life science", "clinical"] },
  { group: "Finance", keywords: ["financ", "bank", "insur", "invest", "capital", "asset manag", "fintech", "accounting"] },
  { group: "Retail & Consumer", keywords: ["retail", "consumer", "e-commerce", "ecommerce", "fashion", "apparel", "food", "beverage", "hospitality", "restaurant", "wholesale"] },
  { group: "Education & Training", keywords: ["educat", "training", "school", "university", "academ", "e-learning", "elearning"] },
  { group: "Professional Services", keywords: ["consult", "legal", "law ", "advisory", "marketing", "advertis", "agency", "human resources", "recruit", "staffing", "professional service"] },
  { group: "Energy & Utilities", keywords: ["energy", "oil", "gas", "utility", "utilities", "power", "renewable", "mining", "water"] },
];

function industryGroupOf(industry: string): string {
  const s = (industry || "").toLowerCase();
  if (!s) return "";
  for (const { group, keywords } of INDUSTRY_GROUPS) {
    if (keywords.some((k) => s.includes(k))) return group;
  }
  return "Other";
}

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "mYngle Caller Prep" },
      { name: "description", content: "Turn enriched lead Excel files into a focused cold-caller briefing." },
    ],
  }),
  component: App,
});

// ---------- Small UI primitives ----------

function Badge({
  children,
  kind = "neutral",
  className = "",
}: {
  children: React.ReactNode;
  kind?: "neutral" | "warm" | "hot" | "pass" | "caution" | "primary" | "outline";
  className?: string;
}) {
  const map: Record<string, string> = {
    neutral: "bg-secondary text-secondary-foreground",
    warm: "bg-warm text-warm-foreground",
    hot: "bg-hot text-hot-foreground",
    pass: "bg-pass text-pass-foreground",
    caution: "bg-caution text-caution-foreground",
    primary: "bg-primary text-primary-foreground",
    outline: "border border-border bg-background text-foreground",
  };
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ${map[kind]} ${className}`}
    >
      {children}
    </span>
  );
}

function TierBadge({ tier }: { tier: string }) {
  if (!tier) return null;
  const t = cleanTier(tier);
  return <Badge kind={tierKind(tier)}>{t}</Badge>;
}

function CopyBtn({ text, label = "Copy" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          setTimeout(() => setDone(false), 1200);
        } catch {}
      }}
      className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-2 py-1 text-xs font-medium text-foreground transition hover:bg-secondary"
    >
      {done ? "Copied" : label}
    </button>
  );
}

function ExtLink({ href, children }: { href: string; children?: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-primary underline decoration-primary/30 underline-offset-2 hover:decoration-primary break-all"
    >
      {children ?? href}
    </a>
  );
}

function Linkify({ text }: { text: string }) {
  if (!text) return null;
  const urls = extractUrls(text);
  if (!urls.length) return <>{text}</>;
  const parts: React.ReactNode[] = [];
  let rest = text;
  urls.forEach((u, idx) => {
    const i = rest.indexOf(u);
    if (i < 0) return;
    if (i > 0) parts.push(rest.slice(0, i));
    parts.push(
      <ExtLink key={`u${idx}`} href={u}>
        {u}
      </ExtLink>,
    );
    rest = rest.slice(i + u.length);
  });
  if (rest) parts.push(rest);
  return <>{parts}</>;
}

function Card({
  title,
  children,
  icon,
  highlight = false,
  action,
}: {
  title?: string;
  children: React.ReactNode;
  icon?: React.ReactNode;
  highlight?: boolean;
  action?: React.ReactNode;
}) {
  return (
    <section
      className={`rounded-xl border bg-card p-5 shadow-sm ${
        highlight ? "border-primary/40 ring-1 ring-primary/20" : "border-border"
      }`}
    >
      {(title || action) && (
        <header className="mb-3 flex items-center justify-between gap-3">
          <h3 className="flex items-center gap-2 text-sm font-semibold tracking-tight text-foreground">
            {icon}
            {title}
          </h3>
          {action}
        </header>
      )}
      {children}
    </section>
  );
}

function Collapsible({
  title,
  count,
  children,
  defaultOpen = false,
}: {
  title: string;
  count?: number | string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-lg border border-border bg-card">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left text-sm font-medium hover:bg-secondary/50"
      >
        <span className="flex items-center gap-2">
          <span className="text-muted-foreground">{open ? "▾" : "▸"}</span>
          {title}
          {count !== undefined && count !== "" && (
            <span className="rounded-full bg-secondary px-2 py-0.5 text-xs text-muted-foreground">{count}</span>
          )}
        </span>
      </button>
      {open && <div className="border-t border-border p-4">{children}</div>}
    </div>
  );
}

// ---------- App ----------

interface MergedRow {
  row: Row;
  sourceFiles: string[];
}

function rowDomainKey(r: Row): string {
  const d = val(r, "domain", "validated_domain", "canonical_company_domain", "input_domain", "domain_used_for_enrichment");
  if (d) return "d::" + d.toLowerCase();
  const name = val(r, "company_name");
  return name ? "n::" + name.toLowerCase() : "";
}

function App() {
  const [files, setFiles] = useState<string[]>([]);
  const [merged, setMerged] = useState<MergedRow[]>([]);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState({
    tier: "all",
    readiness: "all",
    industryGroup: "all",
    employeeRange: "all",
    sourceFile: "all",
    manualReview: false,
    competitor: false,
    hasCallerAngle: false,
    hasEvidence: false,
  });
  const [sortBy, setSortBy] = useState<"score" | "name" | "tier">("score");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFiles = async (fs: FileList | File[]) => {
    const incoming = Array.from(fs);
    if (!incoming.length) return;
    const newRows: MergedRow[] = [];
    const newFileNames: string[] = [];
    for (const f of incoming) {
      const buf = await f.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      const sheetName = wb.SheetNames.includes("Opportunity Input") ? "Opportunity Input" : wb.SheetNames[0];
      const ws = wb.Sheets[sheetName];
      const rows = XLSX.utils.sheet_to_json<Row>(ws, { defval: null });
      newFileNames.push(f.name);
      for (const r of rows) newRows.push({ row: r, sourceFiles: [f.name] });
    }
    // Merge with existing by domain key. Most recent wins (incoming over existing).
    const map = new Map<string, MergedRow>();
    const order: string[] = [];
    const push = (m: MergedRow) => {
      const key = rowDomainKey(m.row);
      if (!key) {
        const uniq = "u::" + order.length + "::" + Math.random();
        order.push(uniq);
        map.set(uniq, m);
        return;
      }
      const ex = map.get(key);
      if (ex) {
        // most recent wins for data; merge source file names
        const sources = Array.from(new Set([...ex.sourceFiles, ...m.sourceFiles]));
        map.set(key, { row: m.row, sourceFiles: sources });
      } else {
        order.push(key);
        map.set(key, m);
      }
    };
    for (const m of merged) push(m);
    for (const m of newRows) push(m);
    setMerged(order.map((k) => map.get(k)!));
    setFiles(Array.from(new Set([...files, ...newFileNames])));
    setSelectedIdx(0);
  };

  const onAddFilesClick = () => fileInputRef.current?.click();
  const onClearAll = () => {
    if (confirm("Clear all uploaded files and companies? This cannot be undone.")) {
      setMerged([]);
      setFiles([]);
      setSelectedIdx(0);
    }
  };

  const filteredSortedRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    let out = merged
      .map((m, i) => ({ m, i }))
      .filter(({ m }) => {
        const r = m.row;
        if (q) {
          const name = val(r, "company_name").toLowerCase();
          const dom = val(r, "domain", "validated_domain", "canonical_company_domain").toLowerCase();
          if (!name.includes(q) && !dom.includes(q)) return false;
        }
        if (filters.tier !== "all" && cleanTier(val(r, "commercial_tier")) !== filters.tier) return false;
        if (filters.readiness !== "all" && val(r, "outreach_readiness_status") !== filters.readiness) return false;
        if (filters.industryGroup !== "all" && industryGroupOf(val(r, "industry")) !== filters.industryGroup) return false;
        if (filters.employeeRange !== "all" && val(r, "employee_range") !== filters.employeeRange) return false;
        if (filters.sourceFile !== "all" && !m.sourceFiles.includes(filters.sourceFile)) return false;
        if (filters.manualReview && !bool(r, "needs_manual_review")) return false;
        if (filters.competitor && !val(r, "competitor_provider_detected") && !val(r, "competitor_attention_provider_detected"))
          return false;
        if (filters.hasCallerAngle && !val(r, "caller_angle")) return false;
        if (filters.hasEvidence && buildKeyLinks(r).length === 0) return false;
        return true;
      });
    out.sort((a, b) => {
      if (sortBy === "name") return val(a.m.row, "company_name").localeCompare(val(b.m.row, "company_name"));
      if (sortBy === "tier") return cleanTier(val(a.m.row, "commercial_tier")).localeCompare(cleanTier(val(b.m.row, "commercial_tier")));
      return (num(b.m.row, "commercial_fit_score") ?? -Infinity) - (num(a.m.row, "commercial_fit_score") ?? -Infinity);
    });
    return out;
  }, [merged, search, filters, sortBy]);

  useEffect(() => {
    if (!merged.length) return;
    if (!filteredSortedRows.length) return;
    if (!filteredSortedRows.some((x) => x.i === selectedIdx)) {
      setSelectedIdx(filteredSortedRows[0].i);
    }
  }, [filteredSortedRows, selectedIdx, merged.length]);

  const uniq = (key: string): string[] => {
    const s = new Set<string>();
    for (const m of merged) {
      const v = key === "commercial_tier" ? cleanTier(val(m.row, key)) : val(m.row, key);
      if (v) s.add(v);
    }
    return Array.from(s).sort();
  };

  const selected = merged[selectedIdx];
  const hasFiles = merged.length > 0;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <input
        ref={fileInputRef}
        type="file"
        accept=".xlsx,.xls"
        multiple
        className="hidden"
        onChange={(e) => {
          const fs = e.target.files;
          if (fs && fs.length) handleFiles(fs);
          e.target.value = "";
        }}
      />

      <Header
        hasFiles={hasFiles}
        fileCount={files.length}
        visibleCount={filteredSortedRows.length}
        totalCount={merged.length}
        onAddFiles={onAddFilesClick}
        onClearAll={onClearAll}
        selectedRow={selected?.row}
      />

      {!hasFiles ? (
        <Landing onUpload={onAddFilesClick} />
      ) : (
        <div className="mx-auto grid max-w-[1600px] grid-cols-12 gap-4 p-4">
          <aside className="col-span-12 lg:col-span-3 xl:col-span-3">
            <Sidebar
              rows={filteredSortedRows}
              total={merged.length}
              selectedIdx={selectedIdx}
              setSelectedIdx={setSelectedIdx}
              search={search}
              setSearch={setSearch}
              filters={filters}
              setFilters={setFilters}
              sortBy={sortBy}
              setSortBy={setSortBy}
              uniq={uniq}
              sourceFiles={files}
            />
          </aside>
          <main className="col-span-12 space-y-4 lg:col-span-9 xl:col-span-9">
            {selected ? (
              <CompanyView row={selected.row} sourceFiles={selected.sourceFiles} />
            ) : (
              <Card><div className="text-sm text-muted-foreground">No company selected.</div></Card>
            )}
          </main>
        </div>
      )}
    </div>
  );
}

function Header({
  hasFiles,
  fileCount,
  visibleCount,
  totalCount,
  onAddFiles,
  onClearAll,
  selectedRow,
}: {
  hasFiles: boolean;
  fileCount: number;
  visibleCount: number;
  totalCount: number;
  onAddFiles: () => void;
  onClearAll: () => void;
  selectedRow?: Row;
}) {
  const exportTxt = () => {
    if (!selectedRow) return;
    const txt = buildCallerPrepText(selectedRow);
    const name = val(selectedRow, "company_name") || "company";
    const blob = new Blob([txt], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${name}-caller-prep.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const copyPrep = async () => {
    if (!selectedRow) return;
    try { await navigator.clipboard.writeText(buildCallerPrepText(selectedRow)); } catch {}
  };

  return (
    <header className="sticky top-0 z-30 border-b border-border bg-card/95 backdrop-blur">
      <div className="mx-auto flex max-w-[1600px] flex-wrap items-center gap-4 px-4 py-3">
        <div className="flex items-center gap-3">
          <img src={logo} alt="mYngle" className="h-8 w-auto" />
          <div className="hidden h-8 w-px bg-border sm:block" />
          <div>
            <div className="text-sm font-semibold tracking-tight">Caller Prep</div>
            <div className="text-[11px] text-muted-foreground">Sales briefing for cold callers</div>
          </div>
        </div>
        {hasFiles && (
          <div className="text-xs text-muted-foreground">
            <span className="font-medium text-foreground">{fileCount}</span> file{fileCount === 1 ? "" : "s"} ·{" "}
            <span className="font-medium text-foreground">{visibleCount}</span>
            {visibleCount !== totalCount && <> of {totalCount}</>} companies
          </div>
        )}
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={onAddFiles}
            className="inline-flex items-center gap-1 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
          >
            + Add files
          </button>
          {hasFiles && (
            <button
              onClick={onClearAll}
              className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium hover:bg-secondary"
            >
              Clear all files
            </button>
          )}
          <button
            onClick={exportTxt}
            disabled={!selectedRow}
            className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-50"
          >
            Export TXT
          </button>
          <button
            onClick={copyPrep}
            disabled={!selectedRow}
            className="inline-flex items-center gap-1 rounded-md border border-primary bg-background px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary/5 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Copy caller prep
          </button>
        </div>
      </div>
    </header>
  );
}

function Landing({ onUpload }: { onUpload: () => void }) {
  return (
    <div className="mx-auto max-w-2xl px-6 py-20 text-center">
      <img src={logo} alt="mYngle" className="mx-auto mb-8 h-14 w-auto" />
      <h1 className="text-3xl font-bold tracking-tight">Caller Prep</h1>
      <p className="mt-3 text-muted-foreground">
        Upload one or more enriched Excel files to generate company-by-company sales briefings for cold callers.
      </p>
      <button
        onClick={onUpload}
        className="mt-8 inline-flex items-center gap-2 rounded-lg bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground shadow-sm hover:bg-primary/90"
      >
        Upload .xlsx files
      </button>
      <p className="mt-3 text-xs text-muted-foreground">Duplicates are merged by domain where possible.</p>
    </div>
  );
}

function Sidebar({
  rows,
  total,
  selectedIdx,
  setSelectedIdx,
  search,
  setSearch,
  filters,
  setFilters,
  sortBy,
  setSortBy,
  uniq,
  sourceFiles,
}: {
  rows: { m: MergedRow; i: number }[];
  total: number;
  selectedIdx: number;
  setSelectedIdx: (i: number) => void;
  search: string;
  setSearch: (s: string) => void;
  filters: {
    tier: string; readiness: string; industryGroup: string; employeeRange: string; sourceFile: string;
    manualReview: boolean; competitor: boolean; hasCallerAngle: boolean; hasEvidence: boolean;
  };
  setFilters: React.Dispatch<React.SetStateAction<{
    tier: string; readiness: string; industryGroup: string; employeeRange: string; sourceFile: string;
    manualReview: boolean; competitor: boolean; hasCallerAngle: boolean; hasEvidence: boolean;
  }>>;
  sortBy: "score" | "name" | "tier";
  setSortBy: (s: "score" | "name" | "tier") => void;
  uniq: (key: string) => string[];
  sourceFiles: string[];
}) {
  const SelectFilter = ({
    label, value, options, onChange, muted = false,
  }: { label: string; value: string; options: string[]; onChange: (v: string) => void; muted?: boolean }) => (
    <label className="block">
      <span className={`mb-1 block text-[11px] font-medium uppercase tracking-wide ${muted ? "text-muted-foreground/70" : "text-muted-foreground"}`}>{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`w-full rounded-md border bg-background px-2 py-1.5 text-sm ${muted ? "border-border/60 text-muted-foreground" : "border-border"}`}
      >
        <option value="all">All</option>
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    </label>
  );

  const industryGroupOptions = useMemo(() => {
    const s = new Set<string>();
    for (const { m } of rows) {
      const g = industryGroupOf(val(m.row, "industry"));
      if (g) s.add(g);
    }
    // Also include groups present across all loaded rows so options stay stable
    return Array.from(s).sort();
  }, [rows]);

  return (
    <div className="sticky top-[72px] max-h-[calc(100vh-88px)] space-y-3 overflow-y-auto rounded-xl border border-border bg-card p-4 shadow-sm">
      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search company or domain…"
        className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
      />
      <div className="grid grid-cols-2 gap-2">
        <SelectFilter label="Tier" value={filters.tier} options={uniq("commercial_tier")} onChange={(v) => setFilters({ ...filters, tier: v })} />
        <SelectFilter label="Readiness" value={filters.readiness} options={uniq("outreach_readiness_status")} onChange={(v) => setFilters({ ...filters, readiness: v })} />
        <SelectFilter label="Industry group" value={filters.industryGroup} options={industryGroupOptions} onChange={(v) => setFilters({ ...filters, industryGroup: v })} />
        <SelectFilter label="Employee range" value={filters.employeeRange} options={uniq("employee_range")} onChange={(v) => setFilters({ ...filters, employeeRange: v })} />
      </div>
      <SelectFilter
        label="Source file"
        value={filters.sourceFile}
        options={sourceFiles}
        onChange={(v) => setFilters({ ...filters, sourceFile: v })}
        muted
      />
      <div className="flex flex-wrap gap-x-3 gap-y-1.5 text-xs">
        <label className="flex items-center gap-1.5">
          <input type="checkbox" checked={filters.manualReview} onChange={(e) => setFilters({ ...filters, manualReview: e.target.checked })} />
          Manual review
        </label>
        <label className="flex items-center gap-1.5">
          <input type="checkbox" checked={filters.competitor} onChange={(e) => setFilters({ ...filters, competitor: e.target.checked })} />
          Competitor
        </label>
        <label className="flex items-center gap-1.5">
          <input type="checkbox" checked={filters.hasCallerAngle} onChange={(e) => setFilters({ ...filters, hasCallerAngle: e.target.checked })} />
          Has caller angle
        </label>
        <label className="flex items-center gap-1.5">
          <input type="checkbox" checked={filters.hasEvidence} onChange={(e) => setFilters({ ...filters, hasEvidence: e.target.checked })} />
          Has evidence links
        </label>
      </div>

      <div>
        <span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Sort by</span>
        <div className="flex gap-1 rounded-md border border-border bg-background p-0.5">
          {(["score", "name", "tier"] as const).map((s) => (
            <button
              key={s}
              onClick={() => setSortBy(s)}
              className={`flex-1 rounded px-2 py-1 text-xs font-medium capitalize ${
                sortBy === s ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-secondary"
              }`}
            >
              {s}
            </button>
          ))}
        </div>
      </div>
      <div className="pt-2 text-[11px] text-muted-foreground">
        <span className="font-medium text-foreground">{rows.length}</span> shown of {total} loaded
      </div>
      <ul className="space-y-2">
        {rows.map(({ m, i }) => {
          const r = m.row;
          const tier = val(r, "commercial_tier");
          const score = num(r, "commercial_fit_score");
          const dom = val(r, "domain", "validated_domain", "canonical_company_domain");
          const country = val(r, "country");
          const emp = val(r, "employee_range");
          const readiness = val(r, "outreach_readiness_status");
          const isSel = i === selectedIdx;
          const isManual = bool(r, "needs_manual_review");
          const competitor = val(r, "competitor_provider_detected") || val(r, "competitor_attention_provider_detected");
          return (
            <li key={i}>
              <button
                onClick={() => setSelectedIdx(i)}
                className={`block w-full rounded-lg border p-3 text-left transition ${
                  isSel ? "border-primary bg-primary/5 ring-1 ring-primary/30" : "border-border bg-card hover:border-primary/40 hover:bg-secondary/50"
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold">{safeText(val(r, "company_name"))}</div>
                    {dom && <div className="truncate text-xs text-muted-foreground">{dom}</div>}
                  </div>
                  {score !== null && (
                    <div className="shrink-0 rounded-md bg-secondary px-2 py-0.5 text-sm font-bold tabular-nums text-foreground">
                      {score.toFixed(2)}
                    </div>
                  )}
                </div>
                <div className="mt-2 flex flex-wrap gap-1">
                  {tier && <TierBadge tier={tier} />}
                  {readiness && <Badge kind="outline">{readiness}</Badge>}
                  {isManual && <Badge kind="caution">Manual</Badge>}
                  {competitor && <Badge kind="outline">Competitor</Badge>}
                  {country && <Badge kind="outline">{country}</Badge>}
                  {emp && <Badge kind="outline">{emp}</Badge>}
                </div>
                {m.sourceFiles.length > 0 && (
                  <div className="mt-1.5 truncate text-[10px] text-muted-foreground" title={m.sourceFiles.join(", ")}>
                    📄 {m.sourceFiles.join(", ")}
                  </div>
                )}
              </button>
            </li>
          );
        })}
        {rows.length === 0 && (
          <li className="rounded-md border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
            No companies match your filters.
          </li>
        )}
      </ul>
    </div>
  );
}

// ---------- Company view ----------

function CompanyView({ row, sourceFiles }: { row: Row; sourceFiles: string[] }) {
  const k = val(row, "company_name") + "::" + val(row, "domain", "validated_domain");
  const companyName = val(row, "company_name");
  const domain = val(row, "domain", "validated_domain", "canonical_company_domain");
  const country = val(row, "country");
  const industry = val(row, "industry");
  return (
    <div key={k} className="space-y-4">
      <CompanyHeader row={row} sourceFiles={sourceFiles} />
      <SummaryCards row={row} />
      <KeyLinksCard row={row} />
      <HowToContact row={row} />
      <CallStarterCard row={row} />
      <LushaContacts
        key={k}
        companyName={companyName}
        domain={domain}
        country={country}
        industry={industry}
      />
      <Collapsible title="Advanced">
        <AdvancedDetails row={row} />
      </Collapsible>
    </div>
  );
}

function CompanyHeader({ row, sourceFiles }: { row: Row; sourceFiles: string[] }) {
  const name = safeText(val(row, "company_name"));
  const dom = val(row, "domain", "validated_domain", "canonical_company_domain");
  const url = val(row, "canonical_company_url") || (dom ? `https://${dom}` : "");
  const score = num(row, "commercial_fit_score");
  const tier = val(row, "commercial_tier");
  const readiness = val(row, "outreach_readiness_status");
  const manual = bool(row, "needs_manual_review");
  const domainReview = bool(row, "needs_domain_review");

  return (
    <section className="rounded-xl border border-border bg-card p-6 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-6">
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-bold tracking-tight">{name}</h1>
          {dom && (
            <div className="mt-1 text-sm">
              {url ? <ExtLink href={url}>{dom}</ExtLink> : <span className="text-muted-foreground">{dom}</span>}
            </div>
          )}
          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
            {tier && <TierBadge tier={tier} />}
            {readiness && <Badge kind="primary">{readiness}</Badge>}
            {manual && <Badge kind="caution">Manual review</Badge>}
            {domainReview && <Badge kind="caution">Domain review</Badge>}
          </div>
          <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
            <Meta label="Industry" value={val(row, "industry")} />
            <Meta label="Employees" value={val(row, "employee_range")} />
            <Meta label="Domain" value={dom} />
          </dl>
          {sourceFiles.length > 0 && (
            <div className="mt-3 text-[11px] text-muted-foreground">
              Source file{sourceFiles.length === 1 ? "" : "s"}: {sourceFiles.join(", ")}
            </div>
          )}
        </div>
        <div className="shrink-0 rounded-xl border border-border bg-secondary/40 px-5 py-3 text-center">
          <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Commercial fit
          </div>
          <div className="text-4xl font-bold tabular-nums text-primary">
            {score !== null ? score.toFixed(2) : "—"}
          </div>
        </div>
      </div>
    </section>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-sm font-medium text-foreground">{safeText(value)}</dd>
    </div>
  );
}

function SummaryCards({ row }: { row: Row }) {
  const why = val(row, "icp_why_relevant") || val(row, "raw_evidence_summary");
  const gapsRaw = val(row, "gaps_missing_signals");
  const evidence = val(row, "icp_evidence") || val(row, "raw_evidence_summary");
  const angle = val(row, "caller_angle");

  const friendly = useMemo(() => buildFriendlySignals(row), [row]);

  const showCaution =
    bool(row, "needs_manual_review") ||
    val(row, "scoring_notes") ||
    val(row, "match_notes") ||
    val(row, "sales_action_hint") ||
    val(row, "competitor_provider_detected") ||
    val(row, "competitor_attention_provider_detected");

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      <Card title="Why relevant" icon={<span className="text-accent">✦</span>}>
        <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">
          <Linkify text={why || "—"} />
        </p>
      </Card>

      <Card title="What's hot" icon={<span>🔥</span>}>
        <p className="text-sm leading-relaxed text-foreground">
          {buildHotExplanation(row)}
        </p>
        {friendly.positiveChips.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {friendly.positiveChips.map((label) => (
              <Badge key={label} kind="warm">{label}</Badge>
            ))}
          </div>
        )}
      </Card>

      <Card title="What's not hot" icon={<span className="text-muted-foreground">·</span>}>
        <p className="text-sm leading-relaxed text-foreground">
          {buildNotHotExplanation(row)}
        </p>
        {gapsRaw && (
          <p className="mt-2 text-xs text-muted-foreground"><Linkify text={gapsRaw} /></p>
        )}
        {friendly.weakChips.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {friendly.weakChips.map((label) => (
              <Badge key={label} kind="pass">{label}</Badge>
            ))}
          </div>
        )}
      </Card>

      <Card title="Evidence">
        <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">
          <Linkify text={evidence || "—"} />
        </p>
      </Card>

      <div className="md:col-span-2">
        <Card
          title="Caller angle"
          icon={<span className="text-accent">🎯</span>}
          highlight
          action={angle ? <CopyBtn text={angle} label="Copy caller angle" /> : null}
        >
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">
            {angle ? <Linkify text={angle} /> : <span className="text-muted-foreground">No caller angle generated for this company.</span>}
          </p>
        </Card>
      </div>

      {showCaution && (
        <div className="md:col-span-2">
          <Card title="Caution" icon={<span>⚠</span>}>
            <ul className="space-y-2 text-sm">
              {bool(row, "needs_manual_review") && (
                <li><Badge kind="caution">Manual review</Badge> <span className="ml-1 text-muted-foreground">This company is flagged for manual review.</span></li>
              )}
              {[
                ["sales_action_hint", "Sales action hint"],
                ["match_notes", "Match notes"],
                ["scoring_notes", "Scoring notes"],
              ].map(([k, label]) =>
                val(row, k) ? (
                  <li key={k}>
                    <span className="font-medium">{label}: </span>
                    <span className="text-muted-foreground"><Linkify text={val(row, k)} /></span>
                  </li>
                ) : null,
              )}
              {(val(row, "competitor_provider_detected") || val(row, "competitor_attention_provider_detected")) && (
                <li className="rounded-md border border-caution/40 bg-caution/10 p-3">
                  <div className="text-xs font-semibold uppercase tracking-wide text-caution-foreground">Competitor mention</div>
                  <div className="mt-1 text-sm">
                    Provider: <span className="font-medium">{val(row, "competitor_provider_detected") || val(row, "competitor_attention_provider_detected")}</span>
                    {val(row, "competitor_signal_strength") && <> · Strength: {val(row, "competitor_signal_strength")}</>}
                    {val(row, "competitor_attention_strength") && <> · {val(row, "competitor_attention_strength")}</>}
                  </div>
                  {val(row, "competitor_attention_evidence") && (
                    <div className="mt-1 text-xs text-muted-foreground"><Linkify text={val(row, "competitor_attention_evidence")} /></div>
                  )}
                  {(val(row, "competitor_evidence_url") || val(row, "competitor_attention_url")) && (
                    <div className="mt-1 text-xs">
                      <ExtLink href={val(row, "competitor_evidence_url") || val(row, "competitor_attention_url")} />
                    </div>
                  )}
                  <div className="mt-1 text-xs italic text-muted-foreground">Verify before outreach.</div>
                </li>
              )}
            </ul>
          </Card>
        </div>
      )}
    </div>
  );
}

function KeyLinksCard({ row }: { row: Row }) {
  const links = useMemo(() => buildKeyLinks(row), [row]);
  if (!links.length) return null;
  return (
    <Card title="Key source links" icon={<span>🔗</span>}>
      <ul className="grid gap-2 md:grid-cols-2">
        {links.map((l) => (
          <li
            key={l.url}
            className={`flex items-start justify-between gap-2 rounded-md border p-2.5 text-sm ${
              l.warn ? "border-caution/50 bg-caution/10" : "border-border bg-background"
            }`}
          >
            <div className="min-w-0">
              <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{l.label}</div>
              <div className="truncate"><ExtLink href={l.url}>{l.domain}</ExtLink></div>
            </div>
            <CopyBtn text={l.url} />
          </li>
        ))}
      </ul>
    </Card>
  );
}

function HowToContact({ row }: { row: Row }) {
  const buyer = val(row, "icp_potential_buyer_function", "buyer_route", "buyer_function");
  return (
    <Card title="How to contact" icon={<span>👤</span>}>
      <p className="text-sm text-muted-foreground">Contact data not included in this file.</p>
      {buyer && (
        <p className="mt-2 text-sm">
          <span className="font-medium">Suggested buyer function: </span>
          <span className="text-foreground">{buyer}</span>
        </p>
      )}
      <p className="mt-3 text-xs text-muted-foreground">
        Suggested sources to enrich later: LinkedIn, Lusha, HubSpot, CRM import.
      </p>
    </Card>
  );
}

function CallStarterCard({ row }: { row: Row }) {
  const text = useMemo(() => buildCallStarter(row), [row]);
  return (
    <Card title="Call starter" icon={<span>📞</span>} action={<CopyBtn text={text} label="Copy call starter" />}>
      <p className="whitespace-pre-wrap rounded-md bg-secondary/50 p-3 text-sm leading-relaxed">{text}</p>
    </Card>
  );
}

// ---------- Advanced details (inside single collapsed Advanced section) ----------

function AdvancedDetails({ row }: { row: Row }) {
  const snippets = useMemo(() => extractGoogleSnippets(row), [row]);
  const sigs = useMemo(() => getSignalScores(row), [row]);

  return (
    <div className="space-y-3">
      <Collapsible title="Company and domain">
        <KVList row={row} keys={[
          "input_domain", "validated_domain", "domain_used_for_enrichment",
          "domain_match_confidence", "possible_domain_mismatch", "suggested_domain",
          "domain_check_reason", "domain_source", "needs_domain_review",
          "canonical_company_url", "canonical_company_name", "canonical_company_domain",
        ]} />
      </Collapsible>

      <Collapsible title="Scoring details">
        <KVList row={row} keys={[
          "commercial_fit_score", "commercial_fit_score_75_25_legacy", "commercial_tier",
          "outreach_readiness_status", "model_probability", "lean_model_prob",
          "scoring_profile", "scoring_notes", "employee_range_confidence",
          "employee_range_source", "score_employee_range_source", "score_employee_range_confidence",
        ]} />
      </Collapsible>

      <Collapsible title="Fit signals" count={sigs.length}>
        <div className="grid gap-3 sm:grid-cols-2">
          {sigs.map((s) => {
            const evKey = s.key.replace(/_score$/, "_evidence");
            const ev = val(row, evKey);
            return (
              <div key={s.key} className="rounded-md border border-border bg-background p-3">
                <div className="flex items-center justify-between">
                  <div className="text-sm font-medium">{s.label}</div>
                  <Badge kind={s.score >= 2 ? "warm" : s.score >= 1 ? "outline" : "pass"}>{s.score}</Badge>
                </div>
                {ev && <p className="mt-2 text-xs text-muted-foreground"><Linkify text={ev} /></p>}
              </div>
            );
          })}
        </div>
      </Collapsible>

      <Collapsible title="Google snippets" count={snippets.length}>
        <div className="grid gap-3">
          {snippets.map((s) => (
            <div key={s.index} className="rounded-md border border-border bg-background p-3">
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                {s.queryType && <Badge kind="outline">{s.queryType}</Badge>}
                {s.rank && <span>Rank {s.rank}</span>}
                {s.sourceDomain && <span>· {s.sourceDomain}</span>}
              </div>
              {s.query && <div className="mt-1 text-xs text-muted-foreground">Query: {s.query}</div>}
              {s.title && <div className="mt-1 text-sm font-medium"><Linkify text={s.title} /></div>}
              {s.text && <p className="mt-1 text-sm leading-relaxed"><Linkify text={s.text} /></p>}
              {s.url && (
                <div className="mt-2 flex items-center gap-2 text-xs">
                  <ExtLink href={s.url}>Open source</ExtLink>
                  <CopyBtn text={s.url} label="Copy URL" />
                </div>
              )}
            </div>
          ))}
          {snippets.length === 0 && <div className="text-sm text-muted-foreground">No Google snippets.</div>}
        </div>
      </Collapsible>

      <ParsedJsonEvidence row={row} />

      <Collapsible title="Raw Opportunity Input Row" count={Object.keys(row).length}>
        <RawTable row={row} />
      </Collapsible>
    </div>
  );
}

function ParsedJsonEvidence({ row }: { row: Row }) {
  const jsonKeys = [
    "raw_google_evidence_json",
    "raw_google_evidence_json_01",
    "raw_google_evidence_json_02",
    "raw_google_evidence_json_03",
    "raw_google_evidence_json_parts",
  ];
  const present = jsonKeys.filter((k) => !isBlank(row[k]));
  const [showRaw, setShowRaw] = useState(false);

  const cards = useMemo(() => {
    const out: ReturnType<typeof normalizeParsedEvidence> = [];
    for (const k of present) {
      const parsed = tryParseJson(String(row[k]));
      if (parsed) out.push(...normalizeParsedEvidence(parsed));
    }
    return out;
  }, [present, row]);

  if (!present.length) return null;

  return (
    <Collapsible title="Parsed JSON evidence" count={cards.length}>
      {cards.length === 0 ? (
        <div className="rounded-md border border-caution/40 bg-caution/10 p-3 text-xs">
          Could not parse JSON evidence — showing truncated raw text below.
          <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap text-[11px]">
            {String(row[present[0]]).slice(0, 1000)}…
          </pre>
        </div>
      ) : (
        <>
          <div className="mb-3 flex justify-end">
            <button
              onClick={() => setShowRaw((s) => !s)}
              className="rounded-md border border-border bg-background px-2 py-1 text-xs hover:bg-secondary"
            >
              {showRaw ? "Hide raw JSON" : "View raw JSON"}
            </button>
          </div>
          <div className="grid gap-3">
            {cards.map((c, i) => (
              <div key={i} className="rounded-md border border-border bg-background p-3">
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  {c.queryType && <Badge kind="outline">{c.queryType}</Badge>}
                  {c.rank !== undefined && <span>Rank {String(c.rank)}</span>}
                  {c.sourceDomain && <span>· {c.sourceDomain}</span>}
                </div>
                {c.query && <div className="mt-1 text-xs text-muted-foreground">Query: {c.query}</div>}
                {c.title && <div className="mt-1 text-sm font-medium">{c.title}</div>}
                {c.snippet && <p className="mt-1 text-sm leading-relaxed">{c.snippet}</p>}
                {c.url && (
                  <div className="mt-2 flex items-center gap-2 text-xs">
                    <ExtLink href={c.url}>Open source</ExtLink>
                    <CopyBtn text={c.url} label="Copy URL" />
                  </div>
                )}
              </div>
            ))}
          </div>
          {showRaw && (
            <div className="mt-3 space-y-3">
              {present.map((k) => {
                const raw = String(row[k]);
                const parsed = tryParseJson(raw);
                const pretty = parsed ? JSON.stringify(parsed, null, 2) : raw;
                return (
                  <div key={k} className="rounded-md border border-border bg-secondary/30">
                    <div className="flex items-center justify-between border-b border-border px-3 py-1.5">
                      <code className="text-[11px] font-medium text-muted-foreground">{k}</code>
                      <CopyBtn text={pretty} label="Copy JSON" />
                    </div>
                    <pre className="max-h-96 overflow-auto p-3 font-mono text-[11px] leading-relaxed text-foreground">
{pretty}
                    </pre>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </Collapsible>
  );
}

function RawTable({ row }: { row: Row }) {
  const [q, setQ] = useState("");
  const entries = Object.entries(row).filter(([k, v]) => {
    if (isBlank(v)) return false;
    if (!q) return true;
    const lq = q.toLowerCase();
    return k.toLowerCase().includes(lq) || String(v).toLowerCase().includes(lq);
  });
  return (
    <>
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search keys or values…"
        className="mb-3 w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm"
      />
      <div className="max-h-[600px] overflow-auto rounded-md border border-border">
        <table className="w-full text-xs">
          <tbody>
            {entries.map(([k, v]) => {
              const sv = String(v).trim();
              return (
                <tr key={k} className="border-b border-border last:border-0 align-top">
                  <td className="w-1/3 max-w-xs whitespace-nowrap bg-secondary/50 px-3 py-2 font-mono text-[11px] font-medium text-muted-foreground">
                    {k}
                  </td>
                  <td className="px-3 py-2">
                    <div className="break-words text-foreground">
                      <Linkify text={sv} />
                    </div>
                  </td>
                  <td className="px-2 py-2"><CopyBtn text={sv} /></td>
                </tr>
              );
            })}
            {entries.length === 0 && (
              <tr><td colSpan={3} className="px-3 py-4 text-center text-muted-foreground">No matching fields.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}

function KVList({ row, keys }: { row: Row; keys: string[] }) {
  const items = keys.map((k) => [k, val(row, k)] as const).filter(([, v]) => v);
  if (!items.length) return <div className="text-sm text-muted-foreground">No data.</div>;
  return (
    <dl className="grid gap-3 sm:grid-cols-2">
      {items.map(([k, v]) => (
        <div key={k} className="rounded-md border border-border bg-background p-2.5">
          <dt className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground">{k}</dt>
          <dd className="mt-0.5 break-words text-sm"><Linkify text={v} /></dd>
        </div>
      ))}
    </dl>
  );
}
