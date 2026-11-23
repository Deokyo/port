/* LP Kit — cta.js : evento de clique nos canais/CTAs e barra fixa de contato (mobile). */
(function () {
  "use strict";
  var LP = window.LP;

  LP.ready(function () {
    document.addEventListener("click", function (ev) {
      var el = ev.target.closest("[data-lp-channel], [data-lp-cta]");
      if (!el || el.hidden) return;
      LP.track("cta_click", {
        channel: el.getAttribute("data-lp-channel") || "link",
        location: el.getAttribute("data-lp-cta") || "geral"
      });
    });

    var bar = document.querySelector(".lp-sticky");
    var trigger = document.querySelector("[data-lp-sticky-trigger]");
    if (!bar || !trigger) return;

    var anyVisible = false;
    var links = bar.querySelectorAll("[data-lp-channel]");
    for (var i = 0; i < links.length; i++) { if (!links[i].hidden) anyVisible = true; }
    if (!anyVisible) { bar.hidden = true; return; }

    document.body.setAttribute("data-sticky", "on");
    /* aparece só depois que o fim do hero ficou para trás (acima da tela).
       Escuta de rolagem (não IntersectionObserver): um salto de rolagem não gera transição e o observer não dispararia. */
    var ticking = false;
    function update() {
      ticking = false;
      bar.setAttribute("data-visible", trigger.getBoundingClientRect().top < 0 ? "true" : "false");
    }
    function onScroll() { if (!ticking) { ticking = true; window.requestAnimationFrame(update); } }
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });
    update();
  });
})();
