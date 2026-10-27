"use client";

import { useEffect } from "react";

export function PublicScrollReveals() {
  useEffect(() => {
    if (
      !("IntersectionObserver" in window) ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      return;
    }

    const elements = Array.from(document.querySelectorAll<HTMLElement>("[data-scroll-reveal]"));
    if (!elements.length) return;

    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          (entry.target as HTMLElement).dataset.scrollRevealed = "true";
          observer.unobserve(entry.target);
        }
      }
    }, { threshold: 0.08, rootMargin: "0px 0px -24px 0px" });

    for (const element of elements) {
      if (element.getBoundingClientRect().top >= window.innerHeight) {
        element.dataset.scrollRevealed = "pending";
      }
      observer.observe(element);
    }
    document.documentElement.classList.add("scroll-reveals-enabled");

    return () => {
      observer.disconnect();
      document.documentElement.classList.remove("scroll-reveals-enabled");
      for (const element of elements) delete element.dataset.scrollRevealed;
    };
  }, []);

  return null;
}
