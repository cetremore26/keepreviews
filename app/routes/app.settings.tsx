import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData, useSubmit, useNavigation } from "@remix-run/react";
import { useState, useCallback } from "react";
import {
  Page,
  Card,
  BlockStack,
  Text,
  Select,
  Button,
  Banner,
  Link,
  Checkbox,
  TextField,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";

import { authenticate } from "../shopify.server";
import {
  getOrCreateShop,
  updateWidgetSettings,
  updateReviewRequestSettings,
} from "../models/shop.server";
import { syncShopPlanFromShopify } from "../services/billing.server";
import { getPlan } from "../config/plans.server";
import { logAudit } from "../utils/audit-log.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, billing } = await authenticate.admin(request);
  const shopRecord = await getOrCreateShop(session.shop);
  const shop = await syncShopPlanFromShopify(session.shop, billing).catch(
    () => shopRecord,
  );

  return {
    plan: getPlan(shop.plan),
    widgetPrimaryColor: shop.widgetPrimaryColor,
    widgetLayout: shop.widgetLayout,
    reviewRequestsEnabled: shop.reviewRequestsEnabled,
    reviewRequestDelayDays: shop.reviewRequestDelayDays,
  };
};

// Gating lives here, not just in the UI: even if a request is crafted to
// hit this action directly, a FREE-plan shop cannot persist widget
// customization, and review request emails can never turn themselves on.
export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, billing } = await authenticate.admin(request);
  const shopRecord = await getOrCreateShop(session.shop);
  const shop = await syncShopPlanFromShopify(session.shop, billing).catch(
    () => shopRecord,
  );

  const formData = await request.formData();
  const intent = String(formData.get("intent") ?? "");

  if (intent === "widget") {
    const plan = getPlan(shop.plan);
    if (!plan.features.widgetCustomization) {
      return { error: "Widget customization requires the Pro plan." };
    }

    const widgetPrimaryColor = String(
      formData.get("widgetPrimaryColor") ?? "",
    );
    const widgetLayout = String(formData.get("widgetLayout") ?? "grid");

    if (!/^#[0-9a-fA-F]{6}$/.test(widgetPrimaryColor)) {
      return { error: "Color must be a hex value like #1A1A1A." };
    }
    if (!["grid", "list", "carousel"].includes(widgetLayout)) {
      return { error: "Invalid layout." };
    }

    await updateWidgetSettings(session.shop, {
      widgetPrimaryColor,
      widgetLayout,
    });

    logAudit({
      shopId: shop.id,
      actor: session.shop,
      action: "settings.widget_updated",
      detail: `color=${widgetPrimaryColor} layout=${widgetLayout}`,
    });

    return { ok: true };
  }

  if (intent === "reviewRequests") {
    const reviewRequestsEnabled = formData.get("reviewRequestsEnabled") === "true";
    const reviewRequestDelayDays = Number(
      formData.get("reviewRequestDelayDays") ?? "14",
    );

    if (
      !Number.isInteger(reviewRequestDelayDays) ||
      reviewRequestDelayDays < 1 ||
      reviewRequestDelayDays > 90
    ) {
      return { error: "Delay must be a whole number of days from 1 to 90." };
    }

    await updateReviewRequestSettings(session.shop, {
      reviewRequestsEnabled,
      reviewRequestDelayDays,
    });

    logAudit({
      shopId: shop.id,
      actor: session.shop,
      action: "settings.review_requests_updated",
      detail: `enabled=${reviewRequestsEnabled} delayDays=${reviewRequestDelayDays}`,
    });

    return { ok: true };
  }

  return { error: "Unknown action." };
};

export default function Settings() {
  const {
    plan,
    widgetPrimaryColor,
    widgetLayout,
    reviewRequestsEnabled,
    reviewRequestDelayDays,
  } = useLoaderData<typeof loader>();
  const submit = useSubmit();
  const navigation = useNavigation();
  const isBusy = navigation.state !== "idle";

  const [color, setColor] = useState(widgetPrimaryColor);
  const [layout, setLayout] = useState(widgetLayout);

  const [requestsEnabled, setRequestsEnabled] = useState(
    reviewRequestsEnabled,
  );
  const [delayDays, setDelayDays] = useState(String(reviewRequestDelayDays));

  const handleSaveWidget = useCallback(() => {
    submit(
      { intent: "widget", widgetPrimaryColor: color, widgetLayout: layout },
      { method: "post" },
    );
  }, [submit, color, layout]);

  const handleSaveReviewRequests = useCallback(() => {
    submit(
      {
        intent: "reviewRequests",
        reviewRequestsEnabled: String(requestsEnabled),
        reviewRequestDelayDays: delayDays,
      },
      { method: "post" },
    );
  }, [submit, requestsEnabled, delayDays]);

  const locked = !plan.features.widgetCustomization;

  return (
    <Page>
      <TitleBar title="Settings" />
      <BlockStack gap="400">
        <Card>
          <BlockStack gap="400">
            <Text as="h2" variant="headingMd">
              Post-purchase review requests
            </Text>
            <Text as="p" tone="subdued">
              When enabled, customers get one email per product asking for a
              review, sent automatically after a paid order — never before
              you turn this on, and never for an order that gets cancelled
              first.
            </Text>
            <Checkbox
              label="Send automatic review request emails"
              checked={requestsEnabled}
              onChange={setRequestsEnabled}
            />
            <TextField
              label="Days to wait after purchase before asking"
              type="number"
              min={1}
              max={90}
              autoComplete="off"
              value={delayDays}
              onChange={setDelayDays}
              disabled={!requestsEnabled}
              helpText="Give the product time to actually arrive. 14 days is a reasonable default for most shipping times."
            />
            <div>
              <Button
                variant="primary"
                disabled={isBusy}
                onClick={handleSaveReviewRequests}
              >
                Save
              </Button>
            </div>
          </BlockStack>
        </Card>

        {locked && (
          <Banner tone="info">
            Widget customization is a Pro feature. Your widget still shows
            all approved reviews (up to {plan.features.maxDisplayedReviews})
            with the default look.{" "}
            <Link url="/app/pricing" removeUnderline>
              Upgrade to customize it
            </Link>
            .
          </Banner>
        )}
        <Card>
          <BlockStack gap="400">
            <Text as="h2" variant="headingMd">
              Widget appearance
            </Text>
            <div>
              <Text as="p" variant="bodyMd">
                Primary color (hex)
              </Text>
              <input
                type="color"
                value={color}
                disabled={locked}
                onChange={(e) => setColor(e.target.value)}
                style={{ display: "block", marginTop: 4, width: 60, height: 32 }}
              />
            </div>
            <Select
              label="Layout"
              disabled={locked}
              options={[
                { label: "Grid", value: "grid" },
                { label: "List", value: "list" },
                { label: "Carousel", value: "carousel" },
              ]}
              value={layout}
              onChange={setLayout}
            />
            <div>
              <Button
                variant="primary"
                disabled={locked || isBusy}
                onClick={handleSaveWidget}
              >
                Save
              </Button>
            </div>
          </BlockStack>
        </Card>
      </BlockStack>
    </Page>
  );
}
