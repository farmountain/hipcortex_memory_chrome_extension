/**
 * Contract version.
 *
 * `SCHEMA_VERSION` is carried twice on every capture: as `provenance.schemaVersion`, and inside the
 * reserved metadata object. The duplication is deliberate — the core reads the metadata object
 * without having to understand the rest of the envelope, and a reader of the top-level object does
 * not have to reach into a nested map.
 *
 * A **required-field addition is a breaking version bump.** Adding an optional field is not. The
 * distinction matters because the core's obligation, per `docs/PROTOCOL.md` §1, is to keep a record
 * whose provenance carries an unrecognised version rather than to destroy it.
 */

export const SCHEMA_VERSION = 1 as const;

export type SchemaVersion = typeof SCHEMA_VERSION;

/** Versions this build can produce *and* validate. Anything else is `UNSUPPORTED_VERSION`. */
export const SUPPORTED_SCHEMA_VERSIONS: readonly SchemaVersion[] = [SCHEMA_VERSION];

export function isSupportedSchemaVersion(value: unknown): value is SchemaVersion {
  return typeof value === "number" && SUPPORTED_SCHEMA_VERSIONS.includes(value as SchemaVersion);
}
