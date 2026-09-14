/**
 * The public capture-contract surface.
 *
 * Everything outside `src/schema/` imports from here rather than reaching into individual modules,
 * so the contract has one visible interface and an internal reshuffle cannot ripple through the
 * capture pipeline.
 */

export { SCHEMA_VERSION, SUPPORTED_SCHEMA_VERSIONS, isSupportedSchemaVersion } from "./version.js";
export type { SchemaVersion } from "./version.js";

export { MESSAGE_ROLES } from "./conversation.js";
export type { Attachment, Conversation, Message, MessageRole } from "./conversation.js";

export type { CaptureEvent, Provenance } from "./capture-event.js";

export {
  VALIDATION_ERROR_CODES,
  describeValidationFailure,
  isUtcTimestamp,
  validateCaptureEvent,
} from "./validate.js";
export type { ValidationError, ValidationErrorCode, ValidationResult } from "./validate.js";

export {
  CAPTURE_RECORD_TYPE,
  CAPTURE_SOURCE,
  CAPTURE_TAG,
  RESERVED_PROVENANCE_KEY,
  captureAction,
  readCaptureProvenance,
  renderTranscript,
  toCaptureProvenance,
  toEgressRecord,
} from "./egress.js";
export type { CaptureProvenancePayload, EgressRecord } from "./egress.js";

export {
  CORE_OWNED_EXPORT_FIELDS,
  EXPORT_DOCUMENT_FIELDS,
  EXPORT_RECORD_FIELDS,
  EXPORT_SCHEMA_VERSION,
  SUPPORTED_EXPORT_VERSIONS,
  parseExportDocument,
  readExportDocument,
  toExportDocument,
} from "./export-document.js";
export type {
  ExportDocument,
  ExportReadFailure,
  ExportReadNote,
  ExportReadResult,
  ExportRecord,
  ExportSourceIdentity,
  ParsedExportDocument,
} from "./export-document.js";
