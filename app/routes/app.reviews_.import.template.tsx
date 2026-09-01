import type { LoaderFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { buildCsv } from "../utils/csv.server";
import { CSV_TEMPLATE_COLUMNS } from "../services/review-import.server";

// Downloadable starting point for the import CSV, with one example row so
// merchants can see the expected format instead of guessing at columns.
export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);

  const csv = buildCsv(CSV_TEMPLATE_COLUMNS, [
    [
      "example-product-handle",
      5,
      "Jane D.",
      "Great quality, arrived faster than expected.",
      "2024-11-03",
      "https://example.com/original-review",
      "",
    ],
  ]);

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="keepreviews-import-template.csv"`,
    },
  });
};
