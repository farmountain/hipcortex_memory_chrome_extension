export class HipCortexClient {
  constructor(baseUrl, apiKey = "") {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.apiKey = apiKey;
  }

  headers() {
    const h = { "Content-Type": "application/json", Accept: "application/json" };
    if (this.apiKey) {
      h["Authorization"] = `Bearer ${this.apiKey}`;
      h["X-API-Key"] = this.apiKey;
    }
    return h;
  }

  async health() {
    try {
      const res = await fetch(`${this.baseUrl}/health`, {
        method: "GET",
        headers: this.headers(),
        signal: AbortSignal.timeout(4000),
      });
      if (!res.ok) return { status: "error", healthy: false };
      const text = await res.text();
      if (text.trim().toLowerCase() === "ok") return { status: "ok", healthy: true };
      try {
        const json = JSON.parse(text);
        return { status: json.status ?? "ok", service: json.service, version: json.version, tier: json.tier, healthy: true };
      } catch {
        return { status: text.slice(0, 32), healthy: true };
      }
    } catch {
      return { status: "unreachable", healthy: false };
    }
  }

  async addMemory(record) {
    const body = {
      actor: record.actor,
      action: record.action,
      target: record.target,
      metadata: record.metadata ?? {},
    };
    if (record.causal_parents) body.causal_parents = record.causal_parents;
    if (record.confidence != null) body.confidence = record.confidence;

    const endpoints = ["/memory/add", "/memory/ingest", "/v1/memory", "/add"];
    let lastError = null;
    for (const ep of endpoints) {
      try {
        const res = await fetch(`${this.baseUrl}${ep}`, {
          method: "POST",
          headers: this.headers(),
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(8000),
        });
        if (res.ok) {
          const data = await res.json().catch(() => ({}));
          return { ...record, id: data.id ?? data.record_id, ...data };
        }
        if (res.status === 404) continue;
        const errText = await res.text();
        lastError = new Error(`HTTP ${res.status}: ${errText.slice(0, 120)}`);
      } catch (e) {
        lastError = e instanceof Error ? e : new Error(String(e));
      }
    }
    throw lastError ?? new Error("No working /memory endpoint found");
  }

  async search(query, limit = 10) {
    const endpoints = [
      { path: "/memory/search", method: "POST", body: { query, limit } },
      { path: `/memory/search?q=${encodeURIComponent(query)}&limit=${limit}`, method: "GET" },
      { path: "/search", method: "POST", body: { query, limit } },
      { path: `/memory/query?query=${encodeURIComponent(query)}&limit=${limit}`, method: "GET" },
    ];
    let lastError = null;
    for (const ep of endpoints) {
      try {
        const res = await fetch(`${this.baseUrl}${ep.path}`, {
          method: ep.method,
          headers: this.headers(),
          body: ep.method === "POST" ? JSON.stringify(ep.body) : undefined,
          signal: AbortSignal.timeout(8000),
        });
        if (res.ok) {
          const data = await res.json();
          if (Array.isArray(data)) return { results: data, count: data.length, query };
          if (data.results && Array.isArray(data.results)) return { results: data.results, count: data.count ?? data.results.length, query };
          if (data.records && Array.isArray(data.records)) return { results: data.records, count: data.records.length, query };
          return { results: [data], count: 1, query };
        }
        if (res.status === 404) continue;
        lastError = new Error(`HTTP ${res.status}`);
      } catch (e) {
        lastError = e instanceof Error ? e : new Error(String(e));
      }
    }
    throw lastError ?? new Error("No working search endpoint found");
  }

  static fromSettings(settings) {
    return new HipCortexClient(settings.apiUrl, settings.apiKey);
  }
}
