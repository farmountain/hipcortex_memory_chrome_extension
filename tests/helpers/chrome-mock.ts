/**
 * Minimal in-memory `chrome.*` for unit tests (task 1.12).
 *
 * Only the surface this extension actually calls is implemented, and that is deliberate: reaching
 * for an API that is not here fails the spec loudly instead of silently returning `undefined`,
 * which surfaces the "why is this code path even touching that API" question at test time rather
 * than in a shipped extension.
 *
 * The storage areas keep their backing object on `data` so a spec can assert what was *persisted*
 * rather than only what was passed to `set` — the distinction that catches "we wrote conversation
 * text into `sync`" (G2.7).
 */

import { vi } from "vitest";

export type MockFn = ReturnType<typeof vi.fn>;

export interface EventMock {
  addListener: MockFn;
  removeListener: MockFn;
  hasListener: MockFn;
}

export interface StorageAreaMock {
  get: MockFn;
  set: MockFn;
  remove: MockFn;
  clear: MockFn;
  data: Record<string, unknown>;
}

export interface NativePortMock {
  postMessage: MockFn;
  disconnect: MockFn;
  onMessage: EventMock;
  onDisconnect: EventMock;
}

export interface ChromeMock {
  storage: { sync: StorageAreaMock; local: StorageAreaMock; session: StorageAreaMock };
  runtime: {
    id: string;
    lastError: { message: string } | undefined;
    sendMessage: MockFn;
    connectNative: MockFn;
    getURL: (resource: string) => string;
    onMessage: EventMock;
    onInstalled: EventMock;
    onStartup: EventMock;
  };
  alarms: {
    create: MockFn;
    clear: MockFn;
    clearAll: MockFn;
    get: MockFn;
    getAll: MockFn;
    onAlarm: EventMock;
  };
  contextMenus: { create: MockFn; removeAll: MockFn; onClicked: EventMock };
  action: {
    setBadgeText: MockFn;
    setBadgeBackgroundColor: MockFn;
    setTitle: MockFn;
    onClicked: EventMock;
  };
  sidePanel: { open: MockFn; setPanelBehavior: MockFn };
  scripting: { executeScript: MockFn };
  tabs: { query: MockFn; sendMessage: MockFn };
  commands: { onCommand: EventMock };
  permissions: { contains: MockFn; request: MockFn };
}

export interface ChromeMockOptions {
  sync?: Record<string, unknown>;
  local?: Record<string, unknown>;
  session?: Record<string, unknown>;
}

function eventMock(): EventMock {
  return {
    addListener: vi.fn(),
    removeListener: vi.fn(),
    hasListener: vi.fn(() => false),
  };
}

export function createStorageArea(initial: Record<string, unknown> = {}): StorageAreaMock {
  const data: Record<string, unknown> = { ...initial };

  return {
    data,
    // `get` mirrors the real overloads: no argument, a string key, an array of keys, or an object
    // of defaults. The defaults overload is the one the settings loader depends on.
    get: vi.fn(async (keys?: unknown) => {
      if (keys === undefined || keys === null) return { ...data };
      if (typeof keys === "string") return keys in data ? { [keys]: data[keys] } : {};
      if (Array.isArray(keys)) {
        const picked: Record<string, unknown> = {};
        for (const key of keys as string[]) if (key in data) picked[key] = data[key];
        return picked;
      }
      const resolved: Record<string, unknown> = {};
      for (const [key, fallback] of Object.entries(keys as Record<string, unknown>)) {
        resolved[key] = key in data ? data[key] : fallback;
      }
      return resolved;
    }),
    set: vi.fn(async (items: Record<string, unknown>) => {
      for (const [key, value] of Object.entries(items)) data[key] = value;
    }),
    remove: vi.fn(async (keys: string | string[]) => {
      for (const key of Array.isArray(keys) ? keys : [keys]) delete data[key];
    }),
    clear: vi.fn(async () => {
      for (const key of Object.keys(data)) delete data[key];
    }),
  };
}

export function createNativePort(): NativePortMock {
  return {
    postMessage: vi.fn(),
    disconnect: vi.fn(),
    onMessage: eventMock(),
    onDisconnect: eventMock(),
  };
}

// ---------- Native Messaging host (task 4.8) ----------

export interface NativeHostOptions {
  /** Delivered through `onMessage` when the port is posted to. Omitted ⇒ the host never answers. */
  reply?: unknown;
  /** `connectNative` throws — an extension-side misuse rather than a missing host. */
  throwMessage?: string;
  /** Chrome reports the failure through `runtime.lastError` instead of throwing. */
  lastErrorMessage?: string;
  /** The port opens, then disconnects without ever replying. */
  disconnectWithoutReply?: boolean;
}

/**
 * A port whose listeners actually fire.
 *
 * The plain `createNativePort` above is inert — its event mocks accept listeners and never call
 * them — which is fine for asserting "this API was touched" and useless for exercising a request /
 * reply. `NativeTransport` awaits a reply, so a spec needs a port that answers; without this, every
 * native case would hang until the response timeout and the suite would prove nothing.
 */
export interface InteractiveNativePort {
  readonly postMessage: MockFn;
  readonly disconnect: MockFn;
  readonly onMessage: EventMock;
  readonly onDisconnect: EventMock;
  /** Exactly what the transport posted, so the outbound envelope can be asserted, not assumed. */
  readonly received: unknown[];
}

export function createInteractivePort(
  options: NativeHostOptions = {}
): InteractiveNativePort {
  const messageListeners: ((message: unknown) => void)[] = [];
  const disconnectListeners: (() => void)[] = [];
  const received: unknown[] = [];

  return {
    received,
    postMessage: vi.fn((message: unknown) => {
      received.push(message);
      if (options.disconnectWithoutReply) {
        queueMicrotask(() => {
          for (const listener of disconnectListeners) listener();
        });
        return;
      }
      if ("reply" in options) {
        const reply = options.reply;
        queueMicrotask(() => {
          for (const listener of messageListeners) listener(reply);
        });
      }
    }),
    disconnect: vi.fn(),
    onMessage: {
      ...eventMock(),
      addListener: vi.fn((callback: (message: unknown) => void) => {
        messageListeners.push(callback);
      }),
    },
    onDisconnect: {
      ...eventMock(),
      addListener: vi.fn((callback: () => void) => {
        disconnectListeners.push(callback);
      }),
    },
  };
}

/**
 * Install a native host onto an existing mock. Returns the ports it handed out, so a spec can
 * assert what was posted and that the port was closed.
 */
export function installNativeHost(mock: ChromeMock, options: NativeHostOptions = {}): InteractiveNativePort[] {
  const ports: InteractiveNativePort[] = [];

  mock.runtime.connectNative = vi.fn(() => {
    if (options.throwMessage !== undefined) {
      throw new Error(options.throwMessage);
    }
    const port = createInteractivePort(options);
    ports.push(port);
    if (options.lastErrorMessage !== undefined) {
      mock.runtime.lastError = { message: options.lastErrorMessage };
    }
    return port;
  });

  return ports;
}

export function createChromeMock(options: ChromeMockOptions = {}): ChromeMock {
  return {
    storage: {
      sync: createStorageArea(options.sync),
      local: createStorageArea(options.local),
      session: createStorageArea(options.session),
    },
    runtime: {
      id: "cortexbridge-spec",
      lastError: undefined,
      sendMessage: vi.fn(async () => ({ success: true })),
      connectNative: vi.fn(() => createNativePort()),
      getURL: (resource: string) => `chrome-extension://cortexbridge-spec/${resource}`,
      onMessage: eventMock(),
      onInstalled: eventMock(),
      onStartup: eventMock(),
    },
    alarms: {
      create: vi.fn(),
      clear: vi.fn(async () => true),
      clearAll: vi.fn(async () => true),
      get: vi.fn(async () => undefined),
      getAll: vi.fn(async () => []),
      onAlarm: eventMock(),
    },
    contextMenus: {
      create: vi.fn(),
      removeAll: vi.fn((callback?: () => void) => callback?.()),
      onClicked: eventMock(),
    },
    action: {
      setBadgeText: vi.fn(async () => undefined),
      setBadgeBackgroundColor: vi.fn(async () => undefined),
      setTitle: vi.fn(async () => undefined),
      onClicked: eventMock(),
    },
    sidePanel: {
      open: vi.fn(async () => undefined),
      setPanelBehavior: vi.fn(async () => undefined),
    },
    scripting: { executeScript: vi.fn(async () => [{ result: "" }]) },
    tabs: { query: vi.fn(async () => []), sendMessage: vi.fn(async () => undefined) },
    commands: { onCommand: eventMock() },
    permissions: { contains: vi.fn(async () => true), request: vi.fn(async () => true) },
  };
}

/** Install a fresh mock as the global `chrome`. Call from `beforeEach`. */
export function installChromeMock(options: ChromeMockOptions = {}): ChromeMock {
  const mock = createChromeMock(options);
  (globalThis as unknown as { chrome: ChromeMock }).chrome = mock;
  return mock;
}
