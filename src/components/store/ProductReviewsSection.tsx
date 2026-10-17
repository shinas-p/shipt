import { useState, useEffect, useMemo } from "react";
import { Star, ThumbsUp, CheckCircle, ShieldCheck, Trash2, Edit3, MessageSquarePlus, AlertCircle, Loader2 } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useCustomerAuth } from "@/lib/auth";
import {
  fetchProductReviews,
  submitProductReview,
  updateProductReview,
  deleteProductReview,
  calculateReviewSummary,
  type ProductReview,
} from "@/lib/reviewsApi";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

interface ProductReviewsSectionProps {
  productId: string;
  productName: string;
  onReviewsChange?: (average: number, total: number) => void;
}

export function ProductReviewsSection({ productId, productName, onReviewsChange }: ProductReviewsSectionProps) {
  const { user, profile } = useCustomerAuth();
  const [reviews, setReviews] = useState<ProductReview[]>([]);
  const [loading, setLoading] = useState(true);
  const [sortBy, setSortBy] = useState<"newest" | "highest">("newest");

  // Review Form state
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [ratingInput, setRatingInput] = useState<number>(5);
  const [hoverRating, setHoverRating] = useState<number | null>(null);
  const [reviewTextInput, setReviewTextInput] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Edit review state
  const [editingReviewId, setEditingReviewId] = useState<string | null>(null);

  // Load reviews on mount / productId change
  const loadReviews = async () => {
    setLoading(true);
    try {
      const data = await fetchProductReviews(productId);
      setReviews(data);
      const summary = calculateReviewSummary(data);
      onReviewsChange?.(summary.average_rating, summary.total_reviews);
    } catch {
      // Non-blocking
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadReviews();
  }, [productId]);

  const summary = useMemo(() => calculateReviewSummary(reviews), [reviews]);

  // Check if current user already reviewed this product
  const userExistingReview = useMemo(() => {
    if (!user) return null;
    return reviews.find((r) => r.user_id === user.id);
  }, [reviews, user]);

  const sortedReviews = useMemo(() => {
    return [...reviews].sort((a, b) => {
      if (sortBy === "highest") {
        return b.rating - a.rating || new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      }
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });
  }, [reviews, sortBy]);

  const handleOpenCreateForm = () => {
    setEditingReviewId(null);
    setRatingInput(5);
    setReviewTextInput("");
    setFormError(null);
    setIsFormOpen(true);
  };

  const handleStartEdit = (rev: ProductReview) => {
    setEditingReviewId(rev.id);
    setRatingInput(rev.rating);
    setReviewTextInput(rev.review_text);
    setFormError(null);
    setIsFormOpen(true);
  };

  const handleCancelForm = () => {
    setIsFormOpen(false);
    setEditingReviewId(null);
    setReviewTextInput("");
    setFormError(null);
  };

  const handleSubmitReview = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    if (!user) {
      setFormError("Please sign in to submit a review.");
      return;
    }

    if (ratingInput < 1 || ratingInput > 5) {
      setFormError("Please select a rating between 1 and 5 stars.");
      return;
    }

    if (reviewTextInput.trim().length < 5) {
      setFormError("Please write at least 5 characters in your review.");
      return;
    }

    setSubmitting(true);
    try {
      if (editingReviewId) {
        // Update existing review
        const res = await updateProductReview({
          reviewId: editingReviewId,
          rating: ratingInput,
          reviewText: reviewTextInput,
        });

        if (!res.success) {
          setFormError(res.error || "Failed to update review.");
        } else {
          toast.success("Review updated successfully!");
          setIsFormOpen(false);
          setEditingReviewId(null);
          await loadReviews();
        }
      } else {
        // Create new review
        const safeDisplayName = profile?.full_name?.trim() || "Campus Student";
        const res = await submitProductReview({
          productId,
          rating: ratingInput,
          reviewText: reviewTextInput,
          customerName: safeDisplayName,
        });

        if (!res.success) {
          setFormError(res.error || "Failed to submit review.");
        } else {
          toast.success("Thank you for reviewing!");
          setIsFormOpen(false);
          setReviewTextInput("");
          await loadReviews();
        }
      }
    } catch (err: any) {
      setFormError(err?.message || "An unexpected error occurred.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteReview = async (reviewId: string) => {
    if (!confirm("Are you sure you want to delete your review?")) return;
    try {
      const res = await deleteProductReview(reviewId);
      if (res.success) {
        toast.success("Review deleted.");
        await loadReviews();
      } else {
        toast.error(res.error || "Could not delete review.");
      }
    } catch {
      toast.error("Failed to delete review.");
    }
  };

  return (
    <section className="mt-12 border-t border-border pt-10" id="reviews">
      <div className="flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="font-display text-2xl font-bold tracking-tight text-foreground">
            Customer Reviews & Ratings
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Authentic feedback from students and staff across Darul Huda campus.
          </p>
        </div>

        {user ? (
          userExistingReview ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => handleStartEdit(userExistingReview)}
              className="gap-1.5 self-start sm:self-auto rounded-full font-semibold border-primary/30 text-primary hover:bg-primary/5"
            >
              <Edit3 className="size-4" />
              <span>Edit Your Review</span>
            </Button>
          ) : (
            <Button
              variant="default"
              size="sm"
              onClick={handleOpenCreateForm}
              className="gap-1.5 self-start sm:self-auto rounded-full font-semibold shadow-xs"
            >
              <MessageSquarePlus className="size-4" />
              <span>Write a Review</span>
            </Button>
          )
        ) : (
          <Link
            to="/account"
            className="inline-flex h-9 items-center gap-1.5 self-start sm:self-auto rounded-full border border-border bg-card px-4 text-xs font-semibold hover:bg-secondary transition"
          >
            <span>Sign in to review</span>
          </Link>
        )}
      </div>

      {/* Review Summary Breakdown */}
      <div className="mt-6 grid gap-6 rounded-3xl border border-border bg-card p-6 shadow-soft sm:grid-cols-12 sm:items-center">
        <div className="flex flex-col items-center justify-center text-center sm:col-span-4 sm:border-r sm:border-border sm:pr-6">
          <span className="font-display text-5xl font-black text-foreground">
            {summary.total_reviews > 0 ? summary.average_rating.toFixed(1) : "—"}
          </span>
          <div className="mt-2 flex items-center gap-1 text-amber-500">
            {[1, 2, 3, 4, 5].map((star) => (
              <Star
                key={star}
                className={cn(
                  "size-5",
                  star <= Math.round(summary.average_rating)
                    ? "fill-amber-400 text-amber-400"
                    : "fill-muted text-muted-foreground/30"
                )}
              />
            ))}
          </div>
          <p className="mt-1.5 text-xs font-medium text-muted-foreground">
            Based on {summary.total_reviews} {summary.total_reviews === 1 ? "student review" : "student reviews"}
          </p>
        </div>

        {/* Rating Distribution Bars */}
        <div className="space-y-2 sm:col-span-8 sm:pl-2">
          {([5, 4, 3, 2, 1] as const).map((star) => {
            const count = summary.rating_breakdown[star] || 0;
            const pct = summary.total_reviews > 0 ? Math.round((count / summary.total_reviews) * 100) : 0;
            return (
              <div key={star} className="flex items-center gap-3 text-xs">
                <span className="w-10 font-bold text-foreground text-right">{star} stars</span>
                <div className="relative h-2.5 flex-1 overflow-hidden rounded-full bg-secondary">
                  <div
                    className="h-full rounded-full bg-amber-400 transition-all duration-500"
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <span className="w-12 text-right font-medium text-muted-foreground">{count} ({pct}%)</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Write / Edit Review Modal Form */}
      {isFormOpen && (
        <div className="mt-6 rounded-3xl border border-primary/25 bg-primary/5 p-6 shadow-soft transition-all animate-in fade-in zoom-in-95">
          <div className="flex items-center justify-between pb-3 border-b border-primary/15">
            <h3 className="font-display text-lg font-bold text-foreground">
              {editingReviewId ? "Edit Your Review" : `Review ${productName}`}
            </h3>
            <span className="text-xs text-muted-foreground">
              Posting as: <strong>{profile?.full_name || "Campus Student"}</strong>
            </span>
          </div>

          <form onSubmit={handleSubmitReview} className="mt-4 space-y-4">
            {formError && (
              <div className="flex items-center gap-2 rounded-xl bg-destructive/10 p-3 text-xs text-destructive">
                <AlertCircle className="size-4 shrink-0" />
                <span>{formError}</span>
              </div>
            )}

            <div>
              <label className="block text-xs font-semibold text-foreground mb-1.5">
                Your Overall Rating *
              </label>
              <div className="flex items-center gap-1.5" role="group" aria-label="Rating selection">
                {[1, 2, 3, 4, 5].map((star) => {
                  const active = (hoverRating ?? ratingInput) >= star;
                  return (
                    <button
                      key={star}
                      type="button"
                      onClick={() => setRatingInput(star)}
                      onMouseEnter={() => setHoverRating(star)}
                      onMouseLeave={() => setHoverRating(null)}
                      className="p-1 transition hover:scale-110 focus:outline-none"
                      aria-label={`${star} star`}
                    >
                      <Star
                        className={cn(
                          "size-7 transition-colors",
                          active ? "fill-amber-400 text-amber-400" : "fill-muted text-muted-foreground/40"
                        )}
                      />
                    </button>
                  );
                })}
                <span className="ml-2 text-xs font-bold text-foreground">
                  {ratingInput === 5
                    ? "5 / 5 (Excellent)"
                    : ratingInput === 4
                    ? "4 / 5 (Very Good)"
                    : ratingInput === 3
                    ? "3 / 5 (Good)"
                    : ratingInput === 2
                    ? "2 / 5 (Fair)"
                    : "1 / 5 (Poor)"}
                </span>
              </div>
            </div>

            <div>
              <div className="flex justify-between items-center mb-1">
                <label className="block text-xs font-semibold text-foreground">Your Review *</label>
                <span className="text-[11px] text-muted-foreground">
                  {reviewTextInput.length} / 1000 characters
                </span>
              </div>
              <textarea
                required
                rows={4}
                maxLength={1000}
                value={reviewTextInput}
                onChange={(e) => setReviewTextInput(e.target.value)}
                placeholder="What did you like or dislike? Was it delivered fast to your hostel room?"
                className="w-full rounded-2xl border border-input bg-background p-3.5 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-ring/30"
              />
            </div>

            <div className="flex flex-wrap items-center justify-end gap-3 pt-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleCancelForm}
                disabled={submitting}
                className="h-10 px-5 rounded-full"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                variant="hero"
                size="sm"
                disabled={submitting}
                className="h-10 px-6 rounded-full font-bold"
              >
                {submitting ? (
                  <>
                    <Loader2 className="mr-2 size-4 animate-spin" />
                    <span>Saving...</span>
                  </>
                ) : editingReviewId ? (
                  "Update Review"
                ) : (
                  "Publish Review"
                )}
              </Button>
            </div>
          </form>
        </div>
      )}

      {/* Sort & Filter Controls */}
      <div className="mt-8 flex items-center justify-between border-b border-border pb-3">
        <h3 className="font-display text-base font-bold text-foreground">
          Student Feedback ({reviews.length})
        </h3>
        <div className="flex items-center gap-2 text-xs">
          <span className="text-muted-foreground hidden sm:inline">Sort by:</span>
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as any)}
            className="h-8 rounded-lg border border-input bg-card px-2.5 text-xs font-semibold outline-none"
            aria-label="Sort reviews"
          >
            <option value="newest">Newest First</option>
            <option value="highest">Highest Rating</option>
          </select>
        </div>
      </div>

      {/* Reviews List */}
      <div className="mt-6 space-y-4">
        {loading ? (
          <div className="flex h-32 items-center justify-center">
            <Loader2 className="size-6 animate-spin text-primary" />
          </div>
        ) : sortedReviews.length === 0 ? (
          <div className="rounded-3xl border border-dashed border-border bg-card/50 p-8 text-center">
            <div className="mx-auto grid size-12 place-items-center rounded-2xl bg-primary/10 text-primary">
              <Star className="size-6" />
            </div>
            <h4 className="mt-3 font-display text-base font-bold text-foreground">No reviews yet</h4>
            <p className="mt-1 text-xs text-muted-foreground">
              Be the first campus student to share your experience with this item!
            </p>
            {user && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleOpenCreateForm}
                className="mt-4 rounded-full text-xs font-bold"
              >
                Write First Review
              </Button>
            )}
          </div>
        ) : (
          sortedReviews.map((rev) => {
            const isAuthor = user && user.id === rev.user_id;
            return (
              <article
                key={rev.id}
                className="rounded-2xl border border-border bg-card p-4 sm:p-5 shadow-2xs transition hover:border-primary/30"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="flex items-center gap-3">
                    <div className="grid size-9 place-items-center rounded-full bg-primary/15 text-primary text-xs font-bold uppercase">
                      {rev.customer_name?.[0] || "S"}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-sans text-sm font-bold text-foreground">
                          {rev.customer_name}
                        </span>
                        {rev.is_verified_purchaser && (
                          <Badge
                            variant="outline"
                            className="h-4 gap-1 px-1.5 text-[10px] font-semibold border-emerald-600/30 text-emerald-700 bg-emerald-500/10"
                          >
                            <ShieldCheck className="size-3" />
                            <span>Verified Purchase</span>
                          </Badge>
                        )}
                      </div>
                      <span className="text-[11px] text-muted-foreground">
                        {new Date(rev.created_at).toLocaleDateString("en-IN", {
                          day: "numeric",
                          month: "short",
                          year: "numeric",
                        })}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-1 text-amber-400">
                    {[1, 2, 3, 4, 5].map((star) => (
                      <Star
                        key={star}
                        className={cn(
                          "size-4",
                          star <= rev.rating
                            ? "fill-amber-400 text-amber-400"
                            : "fill-muted text-muted-foreground/30"
                        )}
                      />
                    ))}
                  </div>
                </div>

                <p className="mt-3 text-sm leading-relaxed text-foreground/90 whitespace-pre-line">
                  {rev.review_text}
                </p>

                {isAuthor && (
                  <div className="mt-3 flex items-center justify-end gap-2 border-t border-border/50 pt-2.5">
                    <button
                      type="button"
                      onClick={() => handleStartEdit(rev)}
                      className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline"
                    >
                      <Edit3 className="size-3" />
                      <span>Edit</span>
                    </button>
                    <span className="text-muted-foreground text-xs">·</span>
                    <button
                      type="button"
                      onClick={() => handleDeleteReview(rev.id)}
                      className="inline-flex items-center gap-1 text-xs font-semibold text-destructive hover:underline"
                    >
                      <Trash2 className="size-3" />
                      <span>Delete</span>
                    </button>
                  </div>
                )}
              </article>
            );
          })
        )}
      </div>
    </section>
  );
}
