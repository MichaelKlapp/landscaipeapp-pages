// Lightweight GA4 event helpers for the static site.
// Safe to include on any page (no-op if GA hasn't loaded yet).
(function () {
  const track = (eventName, params) => {
    try {
      if (typeof window.gtag === "function") {
        window.gtag("event", eventName, params || {});
        return;
      }
      window.dataLayer = window.dataLayer || [];
      window.dataLayer.push(["event", eventName, params || {}]);
    } catch (_) {
      // Intentionally swallow - analytics should never break the site.
    }
  };

  const pagePath = window.location.pathname || "/";

  // --- Download button clicks (App Store / Google Play) ---
  document.addEventListener(
    "click",
    (e) => {
      const a = e.target && e.target.closest ? e.target.closest("a") : null;
      if (!a) return;

      const href = a.getAttribute("href") || "";
      if (!href) return;

      let store = null;
      if (href.includes("apps.apple.com")) store = "apple";
      if (href.includes("play.google.com")) store = "google";

      if (store) {
        track("download_click", {
          store,
          href,
          link_text: (a.textContent || "").trim().slice(0, 120),
          page_path: pagePath,
        });
      }

      // Useful to measure interest even if the portal isn't reachable locally.
      if (href.includes("contractor-portal") || href.includes(":3030")) {
        track("contractor_portal_click", {
          href,
          link_text: (a.textContent || "").trim().slice(0, 120),
          page_path: pagePath,
        });
      }
    },
    { capture: true }
  );

  // --- Blog engagement ---
  if (pagePath === "/blog.html" || pagePath.endsWith("/blog.html")) {
    track("blog_list_view", { page_path: pagePath });
  }

  if (pagePath.includes("/blog/") && pagePath.endsWith(".html")) {
    const slug = pagePath.split("/blog/")[1].replace(/\.html$/, "");
    track("blog_post_view", { slug, page_path: pagePath });
  }

  // --- "Transform" feature engagement (homepage before/after slider) ---
  const sliderHandle = document.getElementById("sliderHandle");
  const sliderWrapper = document.querySelector(".slider-wrapper");
  const sliderContainer = document.querySelector(".slider-container") || sliderWrapper;

  let sliderInteracted = false;
  const markSliderInteraction = (interactionType) => {
    if (sliderInteracted) return;
    sliderInteracted = true;
    track("transform_slider_interaction", {
      interaction_type: interactionType,
      page_path: pagePath,
    });
  };

  if (sliderHandle) {
    sliderHandle.addEventListener("mousedown", () => markSliderInteraction("drag"));
    sliderHandle.addEventListener("touchstart", () => markSliderInteraction("drag"), { passive: true });
  }
  if (sliderWrapper) {
    sliderWrapper.addEventListener("click", () => markSliderInteraction("click"));
  }

  if (sliderContainer && "IntersectionObserver" in window) {
    let sliderViewed = false;
    const obs = new IntersectionObserver(
      (entries) => {
        if (sliderViewed) return;
        const hit = entries.some((en) => en.isIntersecting && en.intersectionRatio >= 0.35);
        if (!hit) return;
        sliderViewed = true;
        track("transform_slider_view", { page_path: pagePath });
        obs.disconnect();
      },
      { threshold: [0, 0.35, 0.6] }
    );
    obs.observe(sliderContainer);
  }

  // --- Scroll depth (simple milestones) ---
  const scrollMilestones = [25, 50, 75, 90];
  const firedScroll = new Set();

  const computeScrollPercent = () => {
    const doc = document.documentElement;
    const scrollTop = doc.scrollTop || document.body.scrollTop || 0;
    const scrollHeight = doc.scrollHeight || document.body.scrollHeight || 0;
    const clientHeight = doc.clientHeight || window.innerHeight || 1;
    const max = Math.max(1, scrollHeight - clientHeight);
    return Math.round((scrollTop / max) * 100);
  };

  const onScroll = () => {
    const pct = computeScrollPercent();
    for (const m of scrollMilestones) {
      if (pct >= m && !firedScroll.has(m)) {
        firedScroll.add(m);
        track("scroll_depth", { percent: m, page_path: pagePath });
      }
    }
  };

  window.addEventListener("scroll", onScroll, { passive: true });
  setTimeout(onScroll, 1500);

  // --- Time on page (send once when leaving / hiding) ---
  const start = Date.now();
  let sentTime = false;
  const sendTime = (reason) => {
    if (sentTime) return;
    sentTime = true;
    const ms = Math.max(0, Date.now() - start);
    track("time_on_page", {
      engagement_time_msec: ms,
      reason,
      page_path: pagePath,
    });
  };

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") sendTime("hidden");
  });
  window.addEventListener("pagehide", () => sendTime("pagehide"));
  window.addEventListener("beforeunload", () => sendTime("unload"));
})();

