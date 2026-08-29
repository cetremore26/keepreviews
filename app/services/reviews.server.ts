import db from "../db.server";
import { getPlan, type PlanId } from "../config/plans.server";
import type { ReviewStatus, ReviewSource } from "@prisma/client";

/**
 * All read/write access to reviews goes through here. This is where the
 * product's central promise is enforced in code: a shop's plan can change
 * how many APPROVED reviews are *displayed* on the storefront, but it can
 * never delete or hide a review row, and it never affects the moderation
 * panel or CSV export — merchants always see and can export everything
 * they collected, on every plan.
 */

const MAX_BODY_LENGTH = 5000;
const MAX_NAME_LENGTH = 200;

export class ReviewValidationError extends Error {}

export interface NewReviewInput {
  shopId: string;
  productId: string;
  productTitle?: string | null;
  rating: number;
  authorName: string;
  authorEmail?: string | null;
  body: string;
  source: ReviewSource;
  photoUrls?: string[];
}

export function assertValidRating(rating: unknown): asserts rating is number {
  if (
    typeof rating !== "number" ||
    !Number.isInteger(rating) ||
    rating < 1 ||
    rating > 5
  ) {
    throw new ReviewValidationError("Rating must be an integer from 1 to 5.");
  }
}

/**
 * Creates a review in PENDING status. Photo attachment is gated here, not
 * just hidden in the UI, so a crafted request against the storefront
 * endpoint can't smuggle photos onto a free-plan shop.
 */
export async function submitReview(
  input: NewReviewInput,
  planId: PlanId,
) {
  assertValidRating(input.rating);

  const authorName = input.authorName.trim().slice(0, MAX_NAME_LENGTH);
  const body = input.body.trim().slice(0, MAX_BODY_LENGTH);

  if (!authorName) {
    throw new ReviewValidationError("Author name is required.");
  }
  if (!body) {
    throw new ReviewValidationError("Review text is required.");
  }
  if (!input.productId) {
    throw new ReviewValidationError("Missing product.");
  }

  const plan = getPlan(planId);
  const photoUrls = plan.features.photosInReviews
    ? (input.photoUrls ?? []).slice(0, 6)
    : [];

  return db.review.create({
    data: {
      shopId: input.shopId,
      productId: input.productId,
      productTitle: input.productTitle ?? null,
      rating: input.rating,
      authorName,
      authorEmail: input.authorEmail?.trim() || null,
      body,
      source: input.source,
      photos: {
        create: photoUrls.map((url) => ({ url })),
      },
    },
    include: { photos: true },
  });
}

/**
 * Reviews for the storefront widget: APPROVED only, capped by plan. The cap
 * is a LIMIT on the query, never a filter that touches other rows' status —
 * everything past the cap still exists and still counts for average rating.
 */
export async function listReviewsForWidget(
  shopId: string,
  productId: string,
  planId: PlanId,
) {
  const plan = getPlan(planId);

  const [reviews, aggregate] = await Promise.all([
    db.review.findMany({
      where: { shopId, productId, status: "APPROVED" },
      orderBy: { createdAt: "desc" },
      take: plan.features.maxDisplayedReviews ?? undefined,
      include: { photos: true },
    }),
    db.review.aggregate({
      where: { shopId, productId, status: "APPROVED" },
      _avg: { rating: true },
      _count: true,
    }),
  ]);

  return {
    reviews,
    averageRating: aggregate._avg.rating ?? 0,
    totalApprovedCount: aggregate._count,
  };
}

/** Full, unfiltered list for the merchant's moderation panel. Never capped
 *  by plan — the merchant owns all of their data regardless of billing
 *  status. */
export async function listReviewsForAdmin(
  shopId: string,
  filter: { status?: ReviewStatus; productId?: string } = {},
) {
  return db.review.findMany({
    where: {
      shopId,
      ...(filter.status ? { status: filter.status } : {}),
      ...(filter.productId ? { productId: filter.productId } : {}),
    },
    orderBy: { createdAt: "desc" },
    include: { photos: true },
  });
}

export async function setReviewStatus(
  shopId: string,
  reviewId: string,
  status: ReviewStatus,
) {
  // Scope the update by shopId too, not just reviewId, so one shop can never
  // moderate another shop's review by guessing an id.
  const result = await db.review.updateMany({
    where: { id: reviewId, shopId },
    data: { status },
  });

  if (result.count === 0) {
    throw new ReviewValidationError("Review not found for this shop.");
  }
}

/** Every review ever collected, for CSV export. Available on every plan by
 *  design — see prompt-claude-code-inicial.md, data portability is part of
 *  the core guarantee, not a paid perk. */
export async function listAllReviewsForExport(shopId: string) {
  return db.review.findMany({
    where: { shopId },
    orderBy: { createdAt: "desc" },
    include: { photos: true },
  });
}
