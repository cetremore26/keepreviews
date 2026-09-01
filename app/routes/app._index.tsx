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
  Button,
  List,
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
    shopDomain: session.shop,
  };
};

export default function Index() {
  const { plan, pendingCount, approvedCount, rejectedCount, shopDomain } =
    useLoaderData<typeof loader>();

  // Deliberately not using the addAppBlockId deep-link param: it errored
  // ("problem with the app block") in testing rather than reliably
  // pre-selecting the block, which would put an alarming error message in
  // front of merchants instead of helping them. Landing on the right
  // template with the block picker one click away, plus the written steps,
  // already satisfies Shopify's onboarding requirement without that risk.
  const themeEditorUrl = `https://${shopDomain}/admin/themes/current/editor?template=product`;

  return (
    <Page>
      <TitleBar title="KeepReviews" />
      <BlockStack gap="500">
        <Card>
          <BlockStack gap="400">
            <Text as="h2" variant="headingMd">
              Add the review widget to your product pages
            </Text>
            <Text as="p" tone="subdued">
              KeepReviews doesn't show up on your storefront until you add it
              from the theme editor. This only needs to be done once:
            </Text>
            <List type="number">
              <List.Item>
                Click "Open theme editor" below — it opens your product page
                template.
              </List.Item>
              <List.Item>
                Click <strong>Add block</strong> where you want reviews to
                appear, open the <strong>Apps</strong> tab, and select{" "}
                <strong>KeepReviews</strong>.
              </List.Item>
              <List.Item>
                Click <strong>Save</strong>.
              </List.Item>
            </List>
            <div>
              <Button variant="primary" url={themeEditorUrl} target="_blank">
                Open theme editor
              </Button>
            </div>
          </BlockStack>
        </Card>
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
                    ? "Unlimited displayed reviews, photos, widget customization, moderation, CSV export, and import from AliExpress, Amazon, Etsy & Shopee."
                    : `Up to ${plan.features.maxDisplayedReviews} displayed reviews on the storefront, plus full moderation, CSV export, and AliExpress import. Every review you collect is stored regardless of plan — see `}
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
