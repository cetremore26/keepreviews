-- Review.productId is now the numeric Shopify product id everywhere.
--
-- Reviews imported from a CSV were stored with the Admin API's GID
-- ("gid://shopify/Product/9392803971322"); storefront reviews were stored
-- with the number the widget sends ("9392803971322"). The widget only ever
-- asks for the number, so imported reviews never showed up. This converts
-- the GID rows to the number the storefront rows already use.
--
-- Deliberately untouched:
--   * "importDedupeKey" — it is hashed over the GID form and the importer
--     still hashes that same form, so re-uploading an already-imported file
--     keeps skipping its rows as duplicates. Recomputing it here would
--     invite exactly the duplicates it exists to prevent.
--   * "ReviewRequest"."productId" — stays a GID by design, see schema.prisma.
--
-- Idempotent: a second run matches no rows. Anchored on both ends, so only a
-- well-formed Product GID is rewritten; any other value is left as it is.
UPDATE "Review"
SET "productId" = regexp_replace("productId", '^gid://shopify/Product/0*([0-9]+)$', '\1')
WHERE "productId" ~ '^gid://shopify/Product/[0-9]+$';
