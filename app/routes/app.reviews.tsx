import { useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData, useSubmit, useNavigation } from "@remix-run/react";
import {
  Page,
  Card,
  IndexTable,
  Badge,
  Text,
  BlockStack,
  Button,
  ButtonGroup,
  Tabs,
  EmptyState,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import type { ReviewStatus } from "@prisma/client";

import { authenticate } from "../shopify.server";
import { getOrCreateShop } from "../models/shop.server";
import {
  listReviewsForAdmin,
  setReviewStatus,
  ReviewValidationError,
} from "../services/reviews.server";
import { logAudit } from "../utils/audit-log.server";

const TABS: { id: string; label: string; status?: ReviewStatus }[] = [
  { id: "pending", label: "Pending", status: "PENDING" },
  { id: "approved", label: "Approved", status: "APPROVED" },
  { id: "rejected", label: "Rejected", status: "REJECTED" },
  { id: "all", label: "All" },
];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await getOrCreateShop(session.shop);

  const url = new URL(request.url);
  const tabId = url.searchParams.get("tab") ?? "pending";
  const tab = TABS.find((t) => t.id === tabId) ?? TABS[0];

  const reviews = await listReviewsForAdmin(shop.id, {
    status: tab.status,
  });

  return { reviews, tabId: tab.id };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await getOrCreateShop(session.shop);

  const formData = await request.formData();
  const reviewId = String(formData.get("reviewId") ?? "");
  const status = String(formData.get("status") ?? "") as ReviewStatus;

  if (!["APPROVED", "REJECTED", "PENDING"].includes(status)) {
    return { error: "Invalid status." };
  }

  try {
    await setReviewStatus(shop.id, reviewId, status);
  } catch (error) {
    if (error instanceof ReviewValidationError) {
      return { error: error.message };
    }
    throw error;
  }

  logAudit({
    shopId: shop.id,
    actor: session.shop,
    action: "review.status_changed",
    detail: `reviewId=${reviewId} status=${status}`,
  });

  return { ok: true };
};

export default function Reviews() {
  const { reviews, tabId } = useLoaderData<typeof loader>();
  const submit = useSubmit();
  const navigation = useNavigation();
  const [selectedTab, setSelectedTab] = useState(
    TABS.findIndex((t) => t.id === tabId),
  );
  const [isExporting, setIsExporting] = useState(false);

  const isBusy = navigation.state !== "idle";

  // A plain <a href> or Polaris's url-based action both fail here: Shopify's
  // embedded-app session cookie is partitioned to the admin iframe, so any
  // real browser navigation (including target="_blank", a new top-level
  // context) leaves it behind and the request comes back unauthenticated.
  // Fetching from inside this same iframe context keeps the cookie intact,
  // so we do the download entirely in JS instead of navigating anywhere.
  const exportCsv = async () => {
    setIsExporting(true);
    try {
      const response = await fetch("/app/reviews/export");
      if (!response.ok) throw new Error("Export failed");
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "keepreviews-export.csv";
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } finally {
      setIsExporting(false);
    }
  };

  const changeTab = (index: number) => {
    setSelectedTab(index);
    submit({ tab: TABS[index].id }, { method: "get" });
  };

  const updateStatus = (reviewId: string, status: ReviewStatus) => {
    submit({ reviewId, status }, { method: "post" });
  };

  const rowMarkup = reviews.map((review, index) => (
    <IndexTable.Row id={review.id} key={review.id} position={index}>
      <IndexTable.Cell>
        <Text as="span" fontWeight="semibold">
          {"★".repeat(review.rating)}
          {"☆".repeat(5 - review.rating)}
        </Text>
      </IndexTable.Cell>
      <IndexTable.Cell>
        <BlockStack gap="050">
          <Text as="span" fontWeight="semibold">
            {review.authorName}
          </Text>
          <Text as="span" tone="subdued">
            {review.productTitle ?? review.productId}
          </Text>
        </BlockStack>
      </IndexTable.Cell>
      <IndexTable.Cell>
        <Text as="span">{review.body}</Text>
      </IndexTable.Cell>
      <IndexTable.Cell>
        <Badge
          tone={
            review.status === "APPROVED"
              ? "success"
              : review.status === "REJECTED"
                ? "critical"
                : "attention"
          }
        >
          {review.status}
        </Badge>
      </IndexTable.Cell>
      <IndexTable.Cell>
        <ButtonGroup>
          {review.status !== "APPROVED" && (
            <Button
              size="slim"
              disabled={isBusy}
              onClick={() => updateStatus(review.id, "APPROVED")}
            >
              Approve
            </Button>
          )}
          {review.status !== "REJECTED" && (
            <Button
              size="slim"
              tone="critical"
              disabled={isBusy}
              onClick={() => updateStatus(review.id, "REJECTED")}
            >
              Reject
            </Button>
          )}
        </ButtonGroup>
      </IndexTable.Cell>
    </IndexTable.Row>
  ));

  return (
    <Page
      secondaryActions={[
        {
          content: "Export CSV",
          onAction: exportCsv,
          loading: isExporting,
        },
      ]}
    >
      <TitleBar title="Reviews" />
      <Card padding="0">
        <Tabs
          tabs={TABS.map((t) => ({ id: t.id, content: t.label }))}
          selected={selectedTab}
          onSelect={changeTab}
        />
        {reviews.length === 0 ? (
          <EmptyState
            heading="No reviews here yet"
            image="https://cdn.shopify.com/s/files/1/0757/9955/files/empty-state.svg"
          >
            <p>
              Reviews submitted on your storefront will show up here for
              moderation. Nothing is ever deleted or hidden due to your plan.
            </p>
          </EmptyState>
        ) : (
          <IndexTable
            itemCount={reviews.length}
            selectable={false}
            headings={[
              { title: "Rating" },
              { title: "Author / product" },
              { title: "Review" },
              { title: "Status" },
              { title: "Actions" },
            ]}
          >
            {rowMarkup}
          </IndexTable>
        )}
      </Card>
    </Page>
  );
}
