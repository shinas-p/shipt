import { describe, expect, it } from "vitest";
import { products as defaultProducts, getProduct } from "@/data/products";
import {
  calculateReviewSummary,
  fetchProductReviews,
  submitProductReview,
  updateProductReview,
  deleteProductReview,
  type ProductReview,
} from "@/lib/reviewsApi";

describe("Shipt — Full-View Product Details & Reviews Experience", { timeout: 25000 }, () => {
  describe("Product Detail Data & Stock Limits", () => {
    it("retrieves valid product by id or slug", () => {
      const p = getProduct("notebook-a5");
      expect(p).toBeDefined();
      expect(p?.name).toBe("Spiral Notebook");
      expect(p?.price).toBeGreaterThan(0);
      expect(p?.stock).toBeGreaterThan(0);
      expect(p?.image).toBeTruthy();
    });

    it("handles invalid or unknown product ids gracefully with undefined", () => {
      const p = getProduct("non-existent-product-id-9999");
      expect(p).toBeUndefined();
    });

    it("verifies out-of-stock and in-stock inventory states across default products", () => {
      const allProds = defaultProducts;
      expect(allProds.length).toBeGreaterThanOrEqual(10);

      // Verify all products have non-negative stock and positive prices
      for (const prod of allProds) {
        expect(prod.stock).toBeGreaterThanOrEqual(0);
        expect(prod.price).toBeGreaterThan(0);
        expect(prod.name).toBeTruthy();
        expect(prod.size).toBeTruthy();
      }

      // Verify out-of-stock product exists in default catalog
      const outOfStock = allProds.find((p) => p.stock === 0);
      expect(outOfStock).toBeDefined();
      expect(outOfStock?.name).toBe("Dark Chocolate Bar");
    });

    it("clamps quantity correctly between 1 and available stock", () => {
      const prod = getProduct("pen-blue-3")!;
      expect(prod).toBeDefined();
      
      const clampQty = (req: number, stock: number) => {
        if (stock === 0) return 0;
        return Math.max(1, Math.min(req, stock));
      };

      // Test lower bound (cannot order 0 or negative)
      expect(clampQty(0, prod.stock)).toBe(1);
      expect(clampQty(-5, prod.stock)).toBe(1);

      // Test upper bound (cannot exceed stock)
      expect(clampQty(prod.stock + 10, prod.stock)).toBe(prod.stock);

      // Normal valid quantity
      expect(clampQty(2, prod.stock)).toBe(2);
    });
  });

  describe("Customer Reviews & Rating Analytics", () => {
    it("calculates average rating and star breakdown accurately", () => {
      const sampleReviews: ProductReview[] = [
        {
          id: "r1",
          product_id: "notebook-a5",
          user_id: "u1",
          rating: 5,
          review_text: "Great notebook for classes",
          customer_name: "Student A",
          created_at: "2026-10-14T10:00:00Z",
          updated_at: "2026-10-14T10:00:00Z",
        },
        {
          id: "r2",
          product_id: "notebook-a5",
          user_id: "u2",
          rating: 4,
          review_text: "Good paper quality",
          customer_name: "Student B",
          created_at: "2026-10-14T11:00:00Z",
          updated_at: "2026-10-14T11:00:00Z",
        },
        {
          id: "r3",
          product_id: "notebook-a5",
          user_id: "u3",
          rating: 3,
          review_text: "Decent for daily notes",
          customer_name: "Student C",
          created_at: "2026-10-14T12:00:00Z",
          updated_at: "2026-10-14T12:00:00Z",
        },
      ];

      const summary = calculateReviewSummary(sampleReviews);
      expect(summary.total_reviews).toBe(3);
      // (5 + 4 + 3) / 3 = 4.0
      expect(summary.average_rating).toBe(4.0);
      expect(summary.rating_breakdown[5]).toBe(1);
      expect(summary.rating_breakdown[4]).toBe(1);
      expect(summary.rating_breakdown[3]).toBe(1);
      expect(summary.rating_breakdown[2]).toBe(0);
      expect(summary.rating_breakdown[1]).toBe(0);
    });

    it("returns zero summary for empty reviews list", () => {
      const summary = calculateReviewSummary([]);
      expect(summary.total_reviews).toBe(0);
      expect(summary.average_rating).toBe(0);
      expect(summary.rating_breakdown[5]).toBe(0);
    });

    it("validates rating boundaries (rejects < 1 or > 5 stars)", async () => {
      const lowResult = await submitProductReview({
        productId: "notebook-a5",
        rating: 0,
        reviewText: "Should fail validation",
        userId: "test-user-1",
      });
      expect(lowResult.success).toBe(false);
      expect(lowResult.error).toContain("between 1 and 5 stars");

      const highResult = await submitProductReview({
        productId: "notebook-a5",
        rating: 6,
        reviewText: "Should fail validation",
        userId: "test-user-1",
      });
      expect(highResult.success).toBe(false);
      expect(highResult.error).toContain("between 1 and 5 stars");
    });

    it("validates review text length boundaries (minimum 5 chars, maximum 1000 chars)", async () => {
      const shortResult = await submitProductReview({
        productId: "notebook-a5",
        rating: 5,
        reviewText: "Hi",
        userId: "test-user-1",
      });
      expect(shortResult.success).toBe(false);
      expect(shortResult.error).toContain("at least 5 characters");

      const longResult = await submitProductReview({
        productId: "notebook-a5",
        rating: 5,
        reviewText: "A".repeat(1001),
        userId: "test-user-1",
      });
      expect(longResult.success).toBe(false);
      expect(longResult.error).toContain("cannot exceed 1000 characters");
    });

    it("enforces authentication when submitting reviews without session", async () => {
      const unauthResult = await submitProductReview({
        productId: "notebook-a5",
        rating: 5,
        reviewText: "Unauthenticated attempt should be blocked",
      });
      expect(unauthResult.success).toBe(false);
      expect(unauthResult.error).toContain("must be signed in");
    });

    it("fetches seeded campus product reviews", async () => {
      const reviews = await fetchProductReviews("notebook-a5");
      expect(Array.isArray(reviews)).toBe(true);
      expect(reviews.length).toBeGreaterThan(0);
      for (const rev of reviews) {
        expect(rev.rating).toBeGreaterThanOrEqual(1);
        expect(rev.rating).toBeLessThanOrEqual(5);
        expect(rev.customer_name).toBeTruthy();
        expect(rev.review_text).toBeTruthy();
      }
    });

    it("submits, updates, and deletes an authenticated review successfully", async () => {
      const uniqueProductId = `test-prod-${Date.now()}`;
      const testUserId = `user-${Date.now()}`;
      
      // Submit
      const submitRes = await submitProductReview({
        productId: uniqueProductId,
        rating: 5,
        reviewText: "Fantastic campus product test!",
        customerName: "Test Reviewer",
        userId: testUserId,
      });
      expect(submitRes.success).toBe(true);
      expect(submitRes.review).toBeDefined();
      expect(submitRes.review?.rating).toBe(5);

      const reviewId = submitRes.review!.id;

      // Update
      const updateRes = await updateProductReview({
        reviewId,
        rating: 4,
        reviewText: "Updated review text: still very good!",
        userId: testUserId,
      });
      expect(updateRes.success).toBe(true);

      // Verify updated content in list
      const afterUpdate = await fetchProductReviews(uniqueProductId);
      const foundUpdated = afterUpdate.find((r) => r.id === reviewId);
      expect(foundUpdated?.rating).toBe(4);
      expect(foundUpdated?.review_text).toBe("Updated review text: still very good!");

      // Delete
      const deleteRes = await deleteProductReview(reviewId, testUserId);
      expect(deleteRes.success).toBe(true);

      const afterDelete = await fetchProductReviews(uniqueProductId);
      expect(afterDelete.find((r) => r.id === reviewId)).toBeUndefined();
    });
  });
});
