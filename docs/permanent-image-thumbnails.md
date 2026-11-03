# Permanent image thumbnails (2026-11-03)

Public product-images display uses /api/image-thumbnail on the owning FDS deployment.
The server checks __thumbs/v1/<original-path>.webp first. On a miss it fetches one
640px contain/quality-65 Supabase transform, persists the response without overwriting,
and redirects to the stored variant. Existing variants never call render/image.
Only this deployment's public product-images paths are accepted; arbitrary URLs,
private buckets, traversal and oversized originals are rejected or bypassed.
Transient failures redirect to the original with no-store. In-process jobs coalesce;
concurrent instances may request the same origin, with conflict-safe uploads.

New browser uploads generate a 640px WebP beside the original. Large previews keep
the original. Cross-project images have no writes: stored variants are attempted
with original fallback. Catalog page thumbnails keep their existing paths.
AI embedding and furniture recognition read persisted variants with original fallback.

No schema, RLS, cron or original-image changes. No full-catalog backfill is required.
The optional backfill-permanent-thumbnails.mjs script defaults to dry-run, requires
an explicit known project ref, skips existing variants, and reports failures.

Validation: TypeScript/build, permanent-thumbnails tests, UI audit, FDS2.0 live
materialization followed by a second cached read; invalid traversal returned 400.
