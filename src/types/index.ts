/**
 * HipCortex Chrome Extension — Core Types
 * Layer 3 / 4 abstractions: Implementation Units, Knowledge Graph nodes
 */

export interface MemoryRecord {
  id?: string;
  actor: string;
  action: string;
  target: string;
  metadata?: Record<string, unknown>;
  timestamp?: string;
  causal_parents?: string[];
  confidence?: number;
}

export interface SearchResult {
  results: MemoryRecord[];
  count?: number;
  query?: string;
}

export interface HealthStatus {
  status: string;
  service?: string;
  version?: string;
  tier?: string;
  healthy: boolean;
}

export interface ExtensionSettings {
  apiUrl: string;
  apiKey: string;
  defaultActor: string;
  autoCapture: boolean;
  injectIntoAiChats: boolean;
  headroomMode: boolean;
}

export const DEFAULT_SETTINGS: ExtensionSettings = {
  apiUrl: "http://127.0.0.1:3030",
  apiKey: "",
  defaultActor: "browser-user",
  autoCapture: false,
  injectIntoAiChats: false,
  headroomMode: true,
};

export type MessageType =
  | { type: "GET_SETTINGS" }
  | { type: "SAVE_SETTINGS"; settings: Partial<ExtensionSettings> }
  | { type: "HEALTH_CHECK" }
  | { type: "ADD_MEMORY"; record: MemoryRecord }
  | { type: "SEARCH_MEMORY"; query: string; limit?: number }
  | { type: "QUICK_ADD_SELECTION"; text: string; url?: string; title?: string };

export type MessageResponse<T = unknown> = {
  success: boolean;
  data?: T;
  error?: string;
};
