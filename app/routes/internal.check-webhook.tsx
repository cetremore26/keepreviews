import { json, type LoaderFunctionArgs } from "@remix-run/node";
import { unauthenticated } from "../shopify.server";
import { verifyCronSecret } from "../utils/cron-auth.server";

// Temporary read-only diagnostic for the stale app/uninstalled webhook
// subscription found via Partner Dashboard delivery logs on
// keepreviews-dev.myshopify.com. Remove once confirmed. See conversation.
export const loader = async ({ request }: LoaderFunctionArgs) => {
  if (!verifyCronSecret(request)) {
    return new Response("Unauthorized", { status: 401 });
  }

  const url = new URL(request.url);
  const shop = url.searchParams.get("shop");
  if (!shop) {
    return new Response("Missing ?shop=", { status: 400 });
  }

  const { admin } = await unauthenticated.admin(shop);

  const response = await admin.graphql(`#graphql
    {
      webhookSubscriptions(first: 10, topics: [APP_UNINSTALLED]) {
        edges {
          node {
            id
            callbackUrl
            createdAt
            updatedAt
            topic
          }
        }
      }
    }
  `);

  const result = await response.json();
  return json({ shop, result });
};
