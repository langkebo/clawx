/**
 * SearXNG Search Provider
 *
 * Self-hosted search engine integration for Viking router.
 * Provides privacy-focused web search without external API dependencies.
 */

export interface SearXNGConfig {
  host: string;
  timeout?: number;
  engines?: string[];
  language?: string;
  safeSearch?: 0 | 1 | 2;
  pageno?: number;
}

export interface SearXNGResult {
  title: string;
  url: string;
  content: string;
  engine?: string;
  publishedDate?: string;
  thumbnail?: string;
}

export interface SearXNGResponse {
  results: SearXNGResult[];
  number_of_results?: number;
  query?: string;
  engines?: string[];
}

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_ENGINES = ["google", "bing", "duckduckgo"];
const DEFAULT_LANGUAGE = "en";

export async function searchWithSearXNG(
  query: string,
  config: SearXNGConfig
): Promise<SearXNGResult[]> {
  const {
    host,
    timeout = DEFAULT_TIMEOUT_MS,
    engines = DEFAULT_ENGINES,
    language = DEFAULT_LANGUAGE,
    safeSearch = 1,
    pageno = 1,
  } = config;

  const url = new URL("/search", host);
  url.searchParams.set("q", query);
  url.searchParams.set("format", "json");
  url.searchParams.set("engines", engines.join(","));
  url.searchParams.set("language", language);
  url.searchParams.set("safesearch", String(safeSearch));
  url.searchParams.set("pageno", String(pageno));

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url.toString(), {
      method: "GET",
      headers: {
        Accept: "application/json",
        "User-Agent": "OpenClaw-Viking/1.0",
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`SearXNG search failed: ${response.status} ${response.statusText}`);
    }

    const data = (await response.json()) as SearXNGResponse;
    return data.results ?? [];
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error(`SearXNG search timeout after ${timeout}ms`);
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
}

export function buildSearXNGContext(
  results: SearXNGResult[],
  maxResults: number = 5
): string {
  if (results.length === 0) {
    return "No search results found.";
  }

  const limited = results.slice(0, maxResults);
  const lines: string[] = ["Web search results:"];

  for (let i = 0; i < limited.length; i++) {
    const r = limited[i];
    lines.push(`\n[${i + 1}] ${r.title}`);
    lines.push(`    URL: ${r.url}`);
    if (r.content) {
      lines.push(`    ${r.content.slice(0, 200)}${r.content.length > 200 ? "..." : ""}`);
    }
    if (r.engine) {
      lines.push(`    Source: ${r.engine}`);
    }
  }

  return lines.join("\n");
}

export function isSearXNGConfigured(config: SearXNGConfig | null | undefined): boolean {
  return Boolean(config?.host);
}

export const SEARXNG_DEFAULT_CONFIG: Partial<SearXNGConfig> = {
  timeout: DEFAULT_TIMEOUT_MS,
  engines: DEFAULT_ENGINES,
  language: DEFAULT_LANGUAGE,
  safeSearch: 1,
};
