import type { LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import {
  Page,
  Layout,
  Text,
  Card,
  BlockStack,
  InlineStack,
  Badge,
  Link,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";

import { authenticate } from "../shopify.server";
import { getOrCreateShop } from "../models/shop.server";
import { syncShopPlanFromShopify } from "../services/billing.server";
import { getPlan } from "../config/plans.server";
import db from "../db.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, billing } = await authenticate.admin(request);

  const shopRecord = await getOrCreateShop(session.shop);
  // Self-heal against any missed billing webhook every time the merchant
  // opens the app — see app/services/billing.server.ts for why this can't
  // rely on webhooks alone.
  const shop = await syncShopPlanFromShopify(session.shop, billing).catch(
    () => shopRecord,
  );

  const [pendingCount, approvedCount, rejectedCount] = await Promise.all([
    db.review.count({ where: { shopId: shop.id, status: "PENDING" } }),
    db.review.count({ where: { shopId: shop.id, status: "APPROVED" } }),
    db.review.count({ where: { shopId: shop.id, status: "REJECTED" } }),
  ]);

  return {
    plan: getPlan(shop.plan),
    pendingCount,
    approvedCount,
    rejectedCount,
  };
};

export default function Index() {
  const { plan, pendingCount, approvedCount, rejectedCount } =
    useLoaderData<typeof loader>();

  return (
    <Page>
      <TitleBar title="KeepReviews" />
      <BlockStack gap="500">
        <Layout>
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <InlineStack align="space-between" blockAlign="center">
                  <Text as="h2" variant="headingMd">
                    Current plan
                  </Text>
                  <Badge tone={plan.id === "PRO" ? "success" : "info"}>
                    {plan.name}
                  </Badge>
                </InlineStack>
                <Text as="p" variant="bodyMd">
                  {plan.id === "PRO"
                    ? "Unlimited displayed reviews, photos, widget customization, moderation, and CSV export."
                    : `Up to ${plan.features.maxDisplayedReviews} displayed reviews on the storefront, plus full moderation and CSV export. Every review you collect is stored regardless of plan — see `}
                  {plan.id === "FREE" && (
                    <Link url="/app/pricing" removeUnderline>
                      upgrade options
                    </Link>
                  )}
                  {plan.id === "FREE" ? "." : null}
                </Text>
              </BlockStack>
            </Card>
          </Layout.Section>
          <Layout.Section>
            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">
                  Reviews at a glance
                </Text>
                <InlineStack gap="600">
                  <BlockStack gap="100">
                    <Text as="span" variant="headingLg">
                      {pendingCount}
                    </Text>
                    <Text as="span" tone="subdued">
                      Pending moderation
                    </Text>
                  </BlockStack>
                  <BlockStack gap="100">
                    <Text as="span" variant="headingLg">
                      {approvedCount}
                    </Text>
                    <Text as="span" tone="subdued">
                      Approved
                    </Text>
                  </BlockStack>
                  <BlockStack gap="100">
                    <Text as="span" variant="headingLg">
                      {rejectedCount}
                    </Text>
                    <Text as="span" tone="subdued">
                      Rejected
                    </Text>
                  </BlockStack>
                </InlineStack>
                <InlineStack>
                  <Link url="/app/reviews" removeUnderline>
                    Go to moderation panel
                  </Link>
                </InlineStack>
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>
      </BlockStack>
    </Page>
  );
}
