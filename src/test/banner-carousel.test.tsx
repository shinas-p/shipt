import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { BannerCarousel } from "@/components/store/BannerCarousel";
import { StoreProvider } from "@/lib/store";

const mockNavigate = vi.fn();

// Mock TanStack Router
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mockNavigate,
  Link: ({ children, to, ...props }: any) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
}));

// Mock Supabase so it uses fallback banners deterministically
vi.mock("@/lib/supabase", () => ({
  isSupabaseConfigured: false,
  supabase: {
    from: vi.fn(),
  },
}));

describe("BannerCarousel Suite — Slide Alignment, Overflow & Mobile Touch Gestures", () => {
  beforeEach(() => {
    mockNavigate.mockClear();
    vi.clearAllMocks();
  });

  function renderCarousel() {
    return render(
      <StoreProvider>
        <BannerCarousel />
      </StoreProvider>
    );
  }

  it("1. Renders the promotional carousel with both fallback banners", () => {
    renderCarousel();

    expect(screen.getByRole("region", { name: /promotions and announcements/i })).toBeInTheDocument();
    expect(screen.getByText("Late-Night Study Fuel")).toBeInTheDocument();
    expect(screen.getByText("Exam Week Survival Kit")).toBeInTheDocument();
  });

  it("2. Has strictly constrained slide widths preventing horizontal overflow", () => {
    renderCarousel();

    const slides = document.querySelectorAll("[data-carousel-slide]");
    expect(slides.length).toBe(2);

    slides.forEach((slide) => {
      // Must have w-full, min-w-full, max-w-full, and basis-full to prevent expansion
      expect(slide.className).toContain("w-full");
      expect(slide.className).toContain("min-w-full");
      expect(slide.className).toContain("max-w-full");
      expect(slide.className).toContain("basis-full");
      expect(slide.className).toContain("shrink-0");
    });
  });

  it("3. Navigates to the second slide and wraps around using arrow buttons", () => {
    renderCarousel();

    const nextBtn = screen.getByRole("button", { name: /next slide/i });
    const prevBtn = screen.getByRole("button", { name: /previous slide/i });
    const paginationDots = screen.getAllByRole("tab", { name: /go to slide/i });

    expect(paginationDots[0]).toHaveAttribute("aria-selected", "true");
    expect(paginationDots[1]).toHaveAttribute("aria-selected", "false");

    // Click next -> moves to slide 2
    fireEvent.click(nextBtn);
    expect(paginationDots[0]).toHaveAttribute("aria-selected", "false");
    expect(paginationDots[1]).toHaveAttribute("aria-selected", "true");

    // Click next again -> wraps around to slide 1
    fireEvent.click(nextBtn);
    expect(paginationDots[0]).toHaveAttribute("aria-selected", "true");
    expect(paginationDots[1]).toHaveAttribute("aria-selected", "false");

    // Click prev -> wraps back to slide 2
    fireEvent.click(prevBtn);
    expect(paginationDots[1]).toHaveAttribute("aria-selected", "true");
  });

  it("4. Allows direct slide selection via pagination dots", () => {
    renderCarousel();

    const paginationDots = screen.getAllByRole("tab", { name: /go to slide/i });

    // Click slide 2 dot
    fireEvent.click(paginationDots[1]!);
    expect(paginationDots[1]).toHaveAttribute("aria-selected", "true");
    expect(paginationDots[0]).toHaveAttribute("aria-selected", "false");

    // Click slide 1 dot
    fireEvent.click(paginationDots[0]!);
    expect(paginationDots[0]).toHaveAttribute("aria-selected", "true");
    expect(paginationDots[1]).toHaveAttribute("aria-selected", "false");
  });

  it("5. Supports mobile touch swipe: swiping left advances to the second slide", () => {
    renderCarousel();

    const container = screen.getByRole("region", { name: /promotions and announcements/i }).firstChild as HTMLElement;
    const paginationDots = screen.getAllByRole("tab", { name: /go to slide/i });

    expect(paginationDots[0]).toHaveAttribute("aria-selected", "true");

    // Simulate touch swipe left: touch start at X=200, move to X=120 (deltaX = -80px)
    fireEvent.touchStart(container, {
      touches: [{ clientX: 200, clientY: 100 }],
    });

    fireEvent.touchMove(container, {
      touches: [{ clientX: 120, clientY: 100 }],
    });

    fireEvent.touchEnd(container);

    // Advanced to slide 2
    expect(paginationDots[1]).toHaveAttribute("aria-selected", "true");
    expect(paginationDots[0]).toHaveAttribute("aria-selected", "false");
  });

  it("6. Supports mobile touch swipe: swiping right moves to previous slide", () => {
    renderCarousel();

    const container = screen.getByRole("region", { name: /promotions and announcements/i }).firstChild as HTMLElement;
    const paginationDots = screen.getAllByRole("tab", { name: /go to slide/i });

    // Go to slide 2 first
    const nextBtn = screen.getByRole("button", { name: /next slide/i });
    fireEvent.click(nextBtn);
    expect(paginationDots[1]).toHaveAttribute("aria-selected", "true");

    // Simulate touch swipe right: touch start at X=100, move to X=180 (deltaX = +80px)
    fireEvent.touchStart(container, {
      touches: [{ clientX: 100, clientY: 100 }],
    });

    fireEvent.touchMove(container, {
      touches: [{ clientX: 180, clientY: 100 }],
    });

    fireEvent.touchEnd(container);

    // Returned to slide 1
    expect(paginationDots[0]).toHaveAttribute("aria-selected", "true");
    expect(paginationDots[1]).toHaveAttribute("aria-selected", "false");
  });

  it("7. Does not trigger slide change if swipe gesture is below threshold", () => {
    renderCarousel();

    const container = screen.getByRole("region", { name: /promotions and announcements/i }).firstChild as HTMLElement;
    const paginationDots = screen.getAllByRole("tab", { name: /go to slide/i });

    expect(paginationDots[0]).toHaveAttribute("aria-selected", "true");

    // Minor movement: deltaX = -15px (below 40px threshold)
    fireEvent.touchStart(container, {
      touches: [{ clientX: 200, clientY: 100 }],
    });

    fireEvent.touchMove(container, {
      touches: [{ clientX: 185, clientY: 100 }],
    });

    fireEvent.touchEnd(container);

    // Remains on slide 1
    expect(paginationDots[0]).toHaveAttribute("aria-selected", "true");
  });

  it("8. Distinguishes vertical page scrolling from horizontal carousel swipe", () => {
    renderCarousel();

    const container = screen.getByRole("region", { name: /promotions and announcements/i }).firstChild as HTMLElement;
    const paginationDots = screen.getAllByRole("tab", { name: /go to slide/i });

    // Vertical drag: diffY = 50px, diffX = 10px
    fireEvent.touchStart(container, {
      touches: [{ clientX: 100, clientY: 100 }],
    });

    fireEvent.touchMove(container, {
      touches: [{ clientX: 90, clientY: 150 }],
    });

    fireEvent.touchEnd(container);

    // Remains on slide 1, did not hijack page scroll
    expect(paginationDots[0]).toHaveAttribute("aria-selected", "true");
  });

  it("9. Suppresses accidental banner clicks immediately after a swipe drag", () => {
    renderCarousel();

    const container = screen.getByRole("region", { name: /promotions and announcements/i }).firstChild as HTMLElement;
    const firstSlide = screen.getAllByRole("button", { name: /promotional banner:/i })[0]!;

    // Perform a swipe
    fireEvent.touchStart(container, {
      touches: [{ clientX: 200, clientY: 100 }],
    });

    fireEvent.touchMove(container, {
      touches: [{ clientX: 120, clientY: 100 }],
    });

    fireEvent.touchEnd(container);

    // Click should be suppressed during swipe completion
    fireEvent.click(firstSlide);
    expect(mockNavigate).not.toHaveBeenCalled();
  });
});
