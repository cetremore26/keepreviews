import db from "../db.server";
import type { Plan, SubscriptionStatus } from "@prisma/client";

/**
 * Every request path that needs shop-level state (admin routes, webhooks,
 * the storefront app proxy) goes through this file. There is exactly one
 * way to read or change a shop's plan so the "never hide/delete reviews"
 * guarantee can't be bypassed by a code path that forgets the rule.
 */

export async function getOrCreateShop(domain: string) {
  const existing = await db.shop.findUnique({ where: { domain } });
  if (existing) return existing;

  return db.shop.create({ data: { domain } });
}

export async function getShopByDomain(domain: string) {
  return db.shop.findUnique({ where: { domain } });
}

export async function setShopPlan(
  domain: string,
  plan: Plan,
  opts: {
    subscriptionId?: string | null;
    subscriptionStatus?: SubscriptionStatus | null;
  } = {},
) {
  const data = {
    plan,
    subscriptionId: opts.subscriptionId ?? null,
    subscriptionStatus: opts.subscriptionStatus ?? null,
    planUpdatedAt: new Date(),
  };

  // Upsert rather than update: a billing webhook can in principle arrive
  // before any admin page load has created the Shop row.
  return db.shop.upsert({
    where: { domain },
    create: { domain, ...data },
    update: data,
  });
}

export async function updateWidgetSettings(
  domain: string,
  settings: { widgetPrimaryColor?: string; widgetLayout?: string },
) {
  return db.shop.update({
    where: { domain },
    data: settings,
  });
}

export async function updateReviewRequestSettings(
  domain: string,
  settings: { reviewRequestsEnabled: boolean; reviewRequestDelayDays: number },
) {
  return db.shop.update({
    where: { domain },
    data: settings,
  });
}
