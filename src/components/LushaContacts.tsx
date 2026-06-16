import { useState } from "react";
import { Button } from "@/components/ui/button";

export interface LushaContact {
  name?: string;
  jobTitle?: string;
  department?: string;
  seniority?: string;
  email?: string;
  phone?: string;
  linkedinUrl?: string;
  matchReason?: string;
  confidence?: number;
}

interface LushaResponse {
  status: "ok" | "not_found" | "error" | string;
  source?: string;
  contacts?: LushaContact[];
  message?: string;
}

interface Props {
  companyName: string;
  domain?: string;
  country?: string;
  industry?: string;
}

const API_URL = "http://127.0.0.1:8008/api/lusha/contacts";

export function LushaContacts({ companyName, domain, country, industry }: Props) {
  const [loading, setLoading] = useState(false);
  const [contacts, setContacts] = useState<LushaContact[] | null>(null);
  const [status, setStatus] = useState<"idle" | "ok" | "not_found" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState<string>("");

  async function fetchContacts() {
    setLoading(true);
    setStatus("idle");
    setErrorMsg("");
    setContacts(null);
    try {
      const res = await fetch(API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyName, domain, country, industry }),
      });
      if (!res.ok) {
        setStatus("error");
        setErrorMsg("Could not reach the Lusha service. Please try again.");
        return;
      }
      const data: LushaResponse = await res.json();
      if (data.status === "ok" && Array.isArray(data.contacts)) {
        setContacts(data.contacts);
        setStatus("ok");
      } else if (data.status === "not_found") {
        setContacts([]);
        setStatus("not_found");
      } else {
        setStatus("error");
        setErrorMsg("Lusha lookup failed. Please try again.");
      }
    } catch {
      setStatus("error");
      setErrorMsg("Could not reach the Lusha service. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  function copyContacts() {
    if (!contacts || contacts.length === 0) return;
    const lines = contacts.map((c) => {
      const parts = [
        c.name,
        c.jobTitle,
        c.department,
        c.seniority,
        c.email,
        c.phone,
        c.linkedinUrl,
      ].filter(Boolean);
      return parts.join(" | ");
    });
    const txt = `Lusha contacts — ${companyName}\n${"=".repeat(40)}\n${lines.join("\n")}`;
    try {
      navigator.clipboard.writeText(txt);
    } catch {}
  }

  return (
    <section className="rounded-xl border border-border bg-card p-6 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-base font-semibold">Lusha contacts</h2>
        <div className="flex gap-2">
          <Button size="sm" onClick={fetchContacts} disabled={loading}>
            {loading ? "Searching…" : "Find Lusha contacts"}
          </Button>
          {status === "ok" && contacts && contacts.length > 0 && (
            <Button size="sm" variant="outline" onClick={copyContacts}>
              Copy contacts
            </Button>
          )}
        </div>
      </div>

      <div className="mt-4">
        {loading && (
          <div className="text-sm text-muted-foreground">Looking up contacts via Lusha…</div>
        )}

        {!loading && status === "not_found" && (
          <div className="text-sm text-muted-foreground">
            No Lusha contacts found for this company.
          </div>
        )}

        {!loading && status === "error" && (
          <div className="text-sm text-destructive">{errorMsg}</div>
        )}

        {!loading && status === "ok" && contacts && contacts.length > 0 && (
          <ul className="grid gap-3 sm:grid-cols-2">
            {contacts.map((c, i) => (
              <li
                key={i}
                className="rounded-lg border border-border bg-background p-3 text-sm"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-semibold truncate">{c.name || "—"}</div>
                    {c.jobTitle && (
                      <div className="text-xs text-muted-foreground truncate">
                        {c.jobTitle}
                      </div>
                    )}
                  </div>
                  {typeof c.confidence === "number" && (
                    <span className="shrink-0 rounded bg-secondary px-2 py-0.5 text-[11px] text-secondary-foreground">
                      {Math.round(c.confidence * 100)}%
                    </span>
                  )}
                </div>
                {(c.department || c.seniority) && (
                  <div className="mt-1 flex flex-wrap gap-1 text-[11px]">
                    {c.department && (
                      <span className="rounded bg-secondary px-1.5 py-0.5 text-secondary-foreground">
                        {c.department}
                      </span>
                    )}
                    {c.seniority && (
                      <span className="rounded bg-secondary px-1.5 py-0.5 text-secondary-foreground">
                        {c.seniority}
                      </span>
                    )}
                  </div>
                )}
                <div className="mt-2 space-y-0.5 text-xs">
                  {c.email && (
                    <div className="truncate">
                      <a className="text-primary hover:underline" href={`mailto:${c.email}`}>
                        {c.email}
                      </a>
                    </div>
                  )}
                  {c.phone && (
                    <div className="truncate">
                      <a className="text-primary hover:underline" href={`tel:${c.phone}`}>
                        {c.phone}
                      </a>
                    </div>
                  )}
                  {c.linkedinUrl && (
                    <div className="truncate">
                      <a
                        className="text-primary hover:underline"
                        href={c.linkedinUrl}
                        target="_blank"
                        rel="noreferrer"
                      >
                        LinkedIn
                      </a>
                    </div>
                  )}
                </div>
                {c.matchReason && (
                  <div className="mt-2 text-[11px] italic text-muted-foreground">
                    {c.matchReason}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
