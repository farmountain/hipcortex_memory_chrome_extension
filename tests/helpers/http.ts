/**
 * A recorded, canned `fetch` (task 4.3 onward).
 *
 * Two properties matter more than convenience here:
 *
 * 1. **Every request is recorded, including the ones that are expected not to happen.** The
 *    strongest assertion available for "a ladder is gone" or "a remote host is refused" is that the
 *    request count is exactly 1 — or exactly 0. A mock that only returns canned bodies cannot make
 *    that assertion, so `requests` is the primary output and the body is secondary.
 * 2. **The response is a real `Response`.** Handing the transport a hand-rolled object would let a
 *    test pass against a shape the platform never provides; `Response` is global from Node 18.
 */

import { vi } from "vitest";

export interface RecordedRequest {
  readonly url: string;
  readonly method: string;
  readonly headers: Record<string, string>;
  readonly body: string | undefined;
  readonly json: unknown;
  /** The query string parsed, so assertions compare decoded values rather than percent-encoding. */
  readonly params: URLSearchParams;
}

export interface CannedResponse {
  readonly status?: number;
  /** Serialised to JSON. Use `text` instead when the body must not be JSON. */
  readonly body?: unknown;
  readonly text?: string;
  /** Simulate a transport-level failure: refused connection, DNS failure, abort. */
  readonly networkError?: string;
}

export interface FetchRecorder {
  readonly requests: RecordedRequest[];
  urls(): string[];
  urlOf(index: number): string;
}

function toHeaderRecord(headers: RequestInit["headers"]): Record<string, string> {
  if (!headers) return {};
  if (headers instanceof Headers) {
    // `Headers.entries()` lives in `lib.dom.iterable`, which this project does not include, so the
    // callback form is used instead of changing the compiler's lib set for a test helper.
    const record: Record<string, string> = {};
    headers.forEach((value, key) => {
      record[key] = value;
    });
    return record;
  }
  if (Array.isArray(headers)) return Object.fromEntries(headers);
  return { ...(headers as Record<string, string>) };
}

function toUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

export function installFetchMock(
  handler: (request: RecordedRequest) => CannedResponse
): FetchRecorder {
  const requests: RecordedRequest[] = [];

  const fetchMock = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = toUrl(input);
    const rawBody = typeof init?.body === "string" ? init.body : undefined;

    let json: unknown;
    try {
      json = rawBody === undefined ? undefined : JSON.parse(rawBody);
    } catch {
      json = undefined;
    }

    const request: RecordedRequest = {
      url,
      method: (init?.method ?? "GET").toUpperCase(),
      headers: toHeaderRecord(init?.headers),
      body: rawBody,
      json,
      params: new URLSearchParams(url.includes("?") ? url.slice(url.indexOf("?") + 1) : ""),
    };
    requests.push(request);

    const canned = handler(request);
    if (canned.networkError !== undefined) {
      throw new TypeError(canned.networkError);
    }

    const text =
      canned.text ?? (canned.body === undefined ? "" : JSON.stringify(canned.body));

    return new Response(text, {
      status: canned.status ?? 200,
      headers: { "content-type": "application/json" },
    });
  };

  vi.stubGlobal("fetch", fetchMock);

  return {
    requests,
    urls: () => requests.map((request) => request.url),
    urlOf: (index: number) => {
      const request = requests[index];
      if (!request) throw new Error(`No request recorded at index ${index}`);
      return request.url;
    },
  };
}

export function jsonBody(body: unknown, status = 200): CannedResponse {
  return { status, body };
}

export function networkFailure(message = "Failed to fetch"): CannedResponse {
  return { networkError: message };
}
