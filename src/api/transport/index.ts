/** The transport layer's public surface. Everything outside `src/api/transport/` imports from here. */

export { createTransport } from "./factory.js";
export { HttpTransport, toMemoryRecord } from "./http.js";
export { NATIVE_HOST, NativeTransport } from "./native.js";
export { interpretAcknowledgement } from "./acknowledge.js";
export {
  ADD_MEMORY_PATH,
  HEALTH_PATH,
  QUERY_PATH,
  SEARCH_PATH,
  hostOfUrl,
  isLoopbackUrl,
  normalizeBaseUrl,
  toAddBody,
} from "./endpoints.js";
export { TransportError, isRecord, messageOf } from "./types.js";
export type {
  DuplicateWarning,
  SearchOptions,
  SendFailureKind,
  SendFailureReason,
  SendResult,
  StructuredQueryOptions,
  Transport,
  TransportMode,
  TransportName,
  TransportResolution,
} from "./types.js";
