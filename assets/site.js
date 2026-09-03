(function () {
  "use strict";

  document.documentElement.classList.add("js");

  function setReady() {
    document.body.classList.add("is-ready");
  }

  function updateProgress() {
    var progress = document.getElementById("scrollProgress");
    if (!progress) return;
    var available = document.documentElement.scrollHeight - window.innerHeight;
    var percent = available > 0 ? Math.min(100, Math.max(0, window.scrollY / available * 100)) : 0;
    progress.style.width = percent + "%";
  }

  function revealSections() {
    var targets = Array.prototype.slice.call(document.querySelectorAll("[data-reveal]"));
    if (!targets.length) return;
    if (!("IntersectionObserver" in window)) {
      targets.forEach(function (target) { target.classList.add("is-visible"); });
      return;
    }
    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        entry.target.classList.add("is-visible");
        observer.unobserve(entry.target);
      });
    }, { threshold: 0.14 });
    targets.forEach(function (target) { observer.observe(target); });
  }

  document.querySelectorAll("[data-current-year]").forEach(function (node) {
    node.textContent = String(new Date().getFullYear());
  });

  window.addEventListener("scroll", updateProgress, { passive: true });
  window.addEventListener("resize", updateProgress);
  revealSections();
  updateProgress();
  window.requestAnimationFrame(setReady);
}());

