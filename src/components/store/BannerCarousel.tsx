import { useEffect, useState, useCallback, useRef } from "react";
import { ChevronLeft, ChevronRight, Sparkles, ArrowRight } from "lucide-react";
import { useNavigate } from "@tanstack/react-router";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { useStore } from "@/lib/store";
import promoImg from "@/assets/promo.jpg";
import heroImg from "@/assets/hero.jpg";
import { cn } from "@/lib/utils";

export interface Banner {
  id: string;
  title: string;
  description: string;
  image_url: string;
  button_text?: string | null;
  button_url?: string | null;
  destination_type?: "category" | "product" | "internal" | "external" | string | null;
  is_active: boolean;
  display_order: number;
}

const FALLBACK_BANNERS: Banner[] = [
  {
    id: "fallback-1",
    title: "Late-Night Study Fuel",
    description: "Crispy chips, biscuits, and energy drinks delivered straight to your hostel door in 20 minutes.",
    image_url: promoImg,
    button_text: "Shop Snacks",
    button_url: "#category-snacks",
    destination_type: "category",
    is_active: true,
    display_order: 1,
  },
  {
    id: "fallback-2",
    title: "Exam Week Survival Kit",
    description: "Spiral notebooks, blue ballpoint pens, and highlighters ready for your revision sessions.",
    image_url: heroImg,
    button_text: "Get Stationery",
    button_url: "#category-stationery",
    destination_type: "category",
    is_active: true,
    display_order: 2,
  },
];

export function BannerCarousel() {
  const [banners, setBanners] = useState<Banner[]>(FALLBACK_BANNERS);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const [dragOffset, setDragOffset] = useState(0);
  const [isDragging, setIsDragging] = useState(false);

  const touchStartXRef = useRef(0);
  const touchStartYRef = useRef(0);
  const touchDeltaXRef = useRef(0);
  const isHorizontalSwipeRef = useRef(false);
  const didSwipeRef = useRef(false);

  const navigate = useNavigate();
  const { setCategory, setDetail, getProduct } = useStore();

  // Fetch active banners from Supabase if available
  useEffect(() => {
    let isMounted = true;

    async function loadBanners() {
      if (!isSupabaseConfigured) return;

      try {
        const { data, error } = await supabase
          .from("banners")
          .select("*")
          .eq("is_active", true)
          .order("display_order", { ascending: true });

        if (error) {
          return;
        }

        if (data && data.length > 0 && isMounted) {
          const now = new Date();
          const activeScheduled = data.filter((b) => {
            if (b.start_at && new Date(b.start_at) > now) return false;
            if (b.end_at && new Date(b.end_at) < now) return false;
            return true;
          });

          if (activeScheduled.length > 0) {
            setBanners(activeScheduled);
          }
        }
      } catch {
        // Graceful fallback to default banners
      }
    }

    loadBanners();
    return () => {
      isMounted = false;
    };
  }, []);

  const slideCount = banners.length;

  const nextSlide = useCallback(() => {
    setCurrentIndex((prev) => (prev + 1) % slideCount);
  }, [slideCount]);

  const prevSlide = useCallback(() => {
    setCurrentIndex((prev) => (prev - 1 + slideCount) % slideCount);
  }, [slideCount]);

  // Autoplay every 4.5 seconds when not paused or dragging
  useEffect(() => {
    if (slideCount <= 1 || isPaused || isDragging) return;

    const timer = setInterval(() => {
      nextSlide();
    }, 4500);

    return () => clearInterval(timer);
  }, [slideCount, isPaused, isDragging, nextSlide]);

  // Touch gesture handling for smooth swipe navigation on mobile
  const handleTouchStart = (e: React.TouchEvent) => {
    if (slideCount <= 1) return;
    const touch = e.touches[0];
    if (!touch) return;

    touchStartXRef.current = touch.clientX;
    touchStartYRef.current = touch.clientY;
    touchDeltaXRef.current = 0;
    isHorizontalSwipeRef.current = false;
    didSwipeRef.current = false;
    setIsPaused(true);
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (slideCount <= 1) return;
    const touch = e.touches[0];
    if (!touch) return;

    const currentX = touch.clientX;
    const currentY = touch.clientY;
    const diffX = currentX - touchStartXRef.current;
    const diffY = currentY - touchStartYRef.current;

    // Detect gesture axis: allow natural vertical scrolling if vertical swipe is dominant
    if (!isHorizontalSwipeRef.current) {
      if (Math.abs(diffY) > Math.abs(diffX) && Math.abs(diffY) > 8) {
        return;
      }
      if (Math.abs(diffX) > 8) {
        isHorizontalSwipeRef.current = true;
        setIsDragging(true);
      }
    }

    if (isHorizontalSwipeRef.current) {
      touchDeltaXRef.current = diffX;

      // Apply resistance when dragging past boundaries
      let effectiveDiff = diffX;
      if (
        (currentIndex === 0 && diffX > 0) ||
        (currentIndex === slideCount - 1 && diffX < 0)
      ) {
        effectiveDiff = diffX * 0.35;
      }

      setDragOffset(effectiveDiff);
    }
  };

  const handleTouchEnd = () => {
    setIsPaused(false);

    if (!isHorizontalSwipeRef.current) {
      setIsDragging(false);
      setDragOffset(0);
      return;
    }

    const finalDiffX = touchDeltaXRef.current;
    const swipeThreshold = 40; // px threshold to trigger slide transition

    if (finalDiffX < -swipeThreshold) {
      nextSlide();
      didSwipeRef.current = true;
    } else if (finalDiffX > swipeThreshold) {
      prevSlide();
      didSwipeRef.current = true;
    }

    setIsDragging(false);
    setDragOffset(0);
    isHorizontalSwipeRef.current = false;

    // Inhibit accidental clicks on the banner during a swipe
    setTimeout(() => {
      didSwipeRef.current = false;
    }, 150);
  };

  const handleBannerClick = (banner: Banner) => {
    // Prevent accidental clicks if the user just performed a swipe gesture
    if (didSwipeRef.current) {
      return;
    }

    const url = banner.button_url?.trim() || "";
    if (!url) return;

    // External URL
    if (url.startsWith("http://") || url.startsWith("https://")) {
      window.open(url, "_blank", "noopener,noreferrer");
      return;
    }

    // Category anchor
    if (url.startsWith("#category-") || url.startsWith("#categories")) {
      const catId = url.replace("#category-", "").replace("#categories", "");
      if (catId && catId !== "#" && catId !== "") {
        setCategory(catId as any);
      }
      const el = document.getElementById("shop") || document.getElementById("categories");
      el?.scrollIntoView({ behavior: "smooth" });
      return;
    }

    // Product anchor or path
    if (url.startsWith("#product-") || url.startsWith("/product/")) {
      const prodId = url.replace("#product-", "").replace("/product/", "");
      const p = getProduct(prodId);
      if (p) {
        setDetail(p);
      } else {
        const el = document.getElementById("shop");
        el?.scrollIntoView({ behavior: "smooth" });
      }
      return;
    }

    // Internal router navigation (e.g. /cart, /checkout, /account)
    try {
      navigate({ to: url as any });
    } catch {
      window.location.href = url;
    }
  };

  if (banners.length === 0) return null;

  return (
    <section
      className="container-page py-2 sm:py-3.5"
      aria-label="Promotions and announcements"
      onMouseEnter={() => setIsPaused(true)}
      onMouseLeave={() => setIsPaused(false)}
    >
      <div
        className="relative h-[170px] xs:h-[180px] sm:h-[200px] lg:h-[225px] w-full overflow-hidden rounded-2xl border border-border/70 bg-card shadow-soft sm:rounded-3xl touch-pan-y select-none"
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onTouchCancel={handleTouchEnd}
      >
        {/* Slides Track */}
        <div
          className={cn(
            "flex h-full w-full",
            isDragging
              ? "transition-none"
              : "transition-transform duration-500 cubic-bezier(0.16, 1, 0.3, 1)"
          )}
          style={{
            transform:
              isDragging && dragOffset !== 0
                ? `translateX(calc(-${currentIndex * 100}% + ${dragOffset}px))`
                : `translateX(-${currentIndex * 100}%)`,
          }}
        >
          {banners.map((banner, idx) => (
            <div
              key={banner.id}
              role="button"
              tabIndex={0}
              onClick={() => handleBannerClick(banner)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  handleBannerClick(banner);
                }
              }}
              className="group relative h-full w-full min-w-full max-w-full basis-full shrink-0 cursor-pointer overflow-hidden focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
              aria-hidden={idx !== currentIndex}
              aria-label={`Promotional banner: ${banner.title}`}
              data-carousel-slide={idx}
            >
              {/* Full Available Background Image with high-priority LCP preloading & explicit dimensions */}
              <img
                src={banner.image_url}
                alt={banner.title}
                width={1200}
                height={450}
                fetchPriority={idx === 0 ? "high" : "auto"}
                loading={idx === 0 ? "eager" : "lazy"}
                decoding={idx === 0 ? "sync" : "async"}
                className="absolute inset-0 h-full w-full object-cover object-center transition-transform duration-700 ease-out group-hover:scale-105"
                onError={(e) => {
                  e.currentTarget.src = promoImg;
                }}
              />

              {/* High-legibility brand gradient overlay across the wide area */}
              <div
                className="pointer-events-none absolute inset-0 bg-gradient-to-r from-[#0d2820]/95 via-[#0d2820]/80 to-[#0d2820]/30 sm:via-[#0d2820]/65 sm:to-transparent"
                aria-hidden="true"
              />

              {/* Text & Action Layer with dedicated horizontal clearance for navigation arrows */}
              <div className="relative z-10 flex h-full w-full min-w-0 max-w-full flex-col justify-center px-10 py-3 text-white xs:px-12 sm:max-w-xl sm:px-14 sm:py-4 lg:px-16">
                <div className="inline-flex items-center gap-1.5 self-start rounded-full bg-lime/20 px-2.5 py-0.5 text-[10px] font-bold text-lime backdrop-blur-xs sm:text-xs">
                  <Sparkles className="size-3 text-lime" />
                  <span>Special Offer</span>
                </div>

                <h3 className="mt-1 font-display text-sm font-extrabold tracking-tight text-white line-clamp-1 xs:text-base sm:mt-2 sm:text-xl md:text-2xl lg:text-3xl">
                  {banner.title}
                </h3>

                <p className="mt-1 text-[11px] leading-snug text-white/90 line-clamp-2 xs:text-xs sm:text-sm sm:leading-relaxed">
                  {banner.description}
                </p>

                {banner.button_text && (
                  <div className="mt-2.5 xs:mt-3 sm:mt-4">
                    <span className="inline-flex items-center gap-1.5 rounded-xl bg-lime px-3 py-1 text-[11px] font-bold text-lime-foreground shadow-sm transition xs:px-3.5 xs:py-1.5 xs:text-xs group-hover:bg-lime/90 group-hover:gap-2">
                      <span>{banner.button_text}</span>
                      <ArrowRight className="size-3 xs:size-3.5 transition-transform" />
                    </span>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* Previous / Next Controls */}
        {slideCount > 1 && (
          <>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                prevSlide();
              }}
              aria-label="Previous slide"
              className="absolute left-1.5 xs:left-2 sm:left-4 top-1/2 -translate-y-1/2 z-20 size-7 xs:size-8 sm:size-9 grid place-items-center rounded-full border border-white/20 bg-black/40 text-white backdrop-blur transition hover:bg-black/60 hover:scale-105 active:scale-95 focus:outline-none"
            >
              <ChevronLeft className="size-3.5 xs:size-4" />
            </button>

            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                nextSlide();
              }}
              aria-label="Next slide"
              className="absolute right-1.5 xs:right-2 sm:right-4 top-1/2 -translate-y-1/2 z-20 size-7 xs:size-8 sm:size-9 grid place-items-center rounded-full border border-white/20 bg-black/40 text-white backdrop-blur transition hover:bg-black/60 hover:scale-105 active:scale-95 focus:outline-none"
            >
              <ChevronRight className="size-3.5 xs:size-4" />
            </button>

            {/* Pagination Dots */}
            <div
              className="absolute bottom-2 xs:bottom-2.5 left-1/2 z-20 flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-black/40 px-2 py-0.5 sm:px-2.5 sm:py-1 backdrop-blur"
              role="tablist"
              aria-label="Carousel pagination"
            >
              {banners.map((_, dotIdx) => (
                <button
                  key={dotIdx}
                  type="button"
                  role="tab"
                  aria-selected={dotIdx === currentIndex}
                  aria-label={`Go to slide ${dotIdx + 1}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    setCurrentIndex(dotIdx);
                  }}
                  className={cn(
                    "h-1.5 rounded-full transition-all duration-300 sm:h-2",
                    dotIdx === currentIndex
                      ? "w-3.5 sm:w-5 bg-lime"
                      : "w-1.5 bg-white/40 hover:bg-white/70 sm:w-2"
                  )}
                />
              ))}
            </div>
          </>
        )}
      </div>
    </section>
  );
}
