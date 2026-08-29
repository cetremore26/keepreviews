import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData, useSubmit, useNavigation } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  BlockStack,
  InlineStack,
  Text,
  Button,
  List,
  Badge,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";

import { authenticate } from "../shopify.server";
import { getOrCreateShop } from "../models/shop.server";
import {
  syncShopPlanFromShopify,
  requestProSubscription,
  cancelProSubscription,
} from "../services/billing.server";
import { PLANS } from "../config/plans.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, billing } = await authenticate.admin(request);
  const shopRecord = await getOrCreateShop(session.shop);
  const shop = await syncShopPlanFromShopify(session.shop, billing).catch(
    () => shopRecord,
  );

  return {
    plan: shop.plan,
    subscriptionId: shop.subscriptionId,
    freeMaxDisplayedReviews: PLANS.FREE.features.maxDisplayedReviews,
    proPrice: PLANS.PRO.price,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, billing } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = String(formData.get("intent") ?? "");
  const appUrl = process.env.SHOPIFY_APP_URL || "";

  if (intent === "upgrade") {
    // billing.request() throws a redirect Response by design.
    return requestProSubscription(billing, appUrl);
  }

  if (intent === "downgrade") {
    const shop = await getOrCreateShop(session.shop);
    if (shop.subscriptionId) {
      await cancelProSubscription(billing, shop.subscriptionId);
      await syncShopPlanFromShopify(session.shop, billing);
    }
    return { ok: true };
  }

  return { error: "Unknown action." };
};

export default function Pricing() {
  const { plan, freeMaxDisplayedReviews, proPrice } =
    useLoaderData<typeof loader>();
  const submit = useSubmit();
  const navigation = useNavigation();
  const isBusy = navigation.state !== "idle";

  return (
    <Page>
      <TitleBar title="Plan & billing" />
      <Layout>
        <Layout.Section variant="oneHalf">
          <Card>
            <BlockStack gap="400">
              <InlineStack align="space-between">
                <Text as="h2" variant="headingLg">
                  Free
                </Text>
                {plan === "FREE" && <Badge tone="info">Current plan</Badge>}
              </InlineStack>
              <Text as="p" variant="headingXl">
                $0
              </Text>
              <List>
                <List.Item>
                  Up to {freeMaxDisplayedReviews} displayed reviews per
                  product
                </List.Item>
                <List.Item>Basic widget, no customization</List.Item>
                <List.Item>Full moderation panel</List.Item>
                <List.Item>CSV export of all your data, anytime</List.Item>
              </List>
            </BlockStack>
          </Card>
        </Layout.Section>
        <Layout.Section variant="oneHalf">
          <Card>
            <BlockStack gap="400">
              <InlineStack align="space-between">
                <Text as="h2" variant="headingLg">
                  Pro
                </Text>
                {plan === "PRO" && <Badge tone="success">Current plan</Badge>}
              </InlineStack>
              <Text as="p" variant="headingXl">
                ${proPrice.toFixed(2)}
                <Text as="span" tone="subdued">
                  {" "}
                  / month
                </Text>
              </Text>
              <List>
                <List.Item>Unlimited displayed reviews</List.Item>
                <List.Item>Photos in reviews</List.Item>
                <List.Item>Widget design customization</List.Item>
                <List.Item>Full moderation panel</List.Item>
                <List.Item>CSV export of all your data, anytime</List.Item>
              </List>
              {plan === "FREE" ? (
                <Button
                  variant="primary"
                  disabled={isBusy}
                  onClick={() => submit({ intent: "upgrade" }, { method: "post" })}
                >
                  Upgrade to Pro
                </Button>
              ) : (
                <Button
                  disabled={isBusy}
                  onClick={() => submit({ intent: "downgrade" }, { method: "post" })}
                >
                  Cancel and return to Free
                </Button>
              )}
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
      <BlockStack gap="200">
        <Text as="p" tone="subdued">
          If you cancel or a payment fails, every review you've already
          collected keeps showing on the Free plan's terms — nothing is ever
          hidden or deleted. You only lose access to Pro-only features until
          you resubscribe.
        </Text>
      </BlockStack>
    </Page>
  );
}
