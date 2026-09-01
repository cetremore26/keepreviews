import { json, type LoaderFunctionArgs } from "@remix-run/node";
import { unauthenticated, registerWebhooks } from "../shopify.server";
import { verifyCronSecret } from "../utils/cron-auth.server";

// Temporary diagnostic/repair endpoint for the stale app/uninstalled webhook
// subscription found via Partner Dashboard delivery logs (keepreviews-dev
// kept pointing at a dead URL from before the Render migration). Deletes
// itself from the codebase once confirmed fixed — see conversation.
export const loader = async ({ request }: LoaderFunctionArgs) => {
  if (!verifyCronSecret(request)) {
    return new Response("Unauthorized", { status: 401 });
  }

  const url = new URL(request.url);
  const shop = url.searchParams.get("shop");
  const doFix = url.searchParams.get("fix") === "true";
  if (!shop) {
    return new Response("Missing ?shop=", { status: 400 });
  }

  const { admin, session } = await unauthenticated.admin(shop);

  const query = `#graphql
    query {
      webhookSubscriptions(first: 25) {
        edges {
          node {
            id
            topic
            endpoint {
              __typename
              ... on WebhookHttpEndpoint { callbackUrl }
            }
          }
        }
      }
    }
  `;

  const before = await (await admin.graphql(query)).json();

  let registerResult = null;
  let after = null;
  if (doFix) {
    registerResult = await registerWebhooks({ session });
    after = await (await admin.graphql(query)).json();
  }

  return json({ shop, before, registerResult, after });
};
