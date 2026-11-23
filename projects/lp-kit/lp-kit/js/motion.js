/* LP Kit — motion.js : reveal ao rolar, escalonamento, contador, progresso, cabeçalho e pausa.
   Sem JS ou com prefers-reduced-motion, tudo continua visível e legível.
   Config opcional: "motion": { "progress": true }. */
(function () {
  "use strict";
  var LP = window.LP;
  var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  LP.motion = { reduced: reduce, paused: false };

  function setIndexes(group) {
    var kids = group.children;
    for (var i = 0; i < kids.length; i++) {
      if (!kids[i].hasAttribute("data-lp-reveal")) kids[i].setAttribute("data-lp-reveal", group.getAttribute("data-lp-stagger") || "");
      kids[i].style.setProperty("--lp-i", String(i));
    }
  }

  function formatCount(v, decimals) {
    try { return new Intl.NumberFormat("pt-BR", { minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(v); }
    catch (e) { return v.toFixed(decimals).replace(".", ","); }
  }

  function countUp(el) {
    var target = parseFloat(el.getAttribute("data-lp-count"));
    if (isNaN(target)) return;
    var decimals = parseInt(el.getAttribute("data-lp-decimals") || "0", 10);
    var final = el.textContent;
    var dur = 1300, t0 = null;
    function frame(t) {
      if (t0 === null) t0 = t;
      var p = Math.min(1, (t - t0) / dur), eased = 1 - Math.pow(1 - p, 3);
      el.textContent = p < 1 ? formatCount(target * eased, decimals) : final; /* termina exatamente no texto original */
      if (p < 1) window.requestAnimationFrame(frame);
    }
    el.textContent = formatCount(0, decimals);
    window.requestAnimationFrame(frame);
  }

  LP.ready(function () {
    /* escalonamento */
    var groups = document.querySelectorAll("[data-lp-stagger]");
    for (var g = 0; g < groups.length; g++) setIndexes(groups[g]);

    /* reveal ao rolar: só segura o que está abaixo da dobra */
    var items = document.querySelectorAll("[data-lp-reveal]");
    var counters = document.querySelectorAll("[data-lp-count]");
    var supportsIO = "IntersectionObserver" in window;

    if (!reduce && supportsIO) {
      var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (e) {
          if (!e.isIntersecting) return;
          e.target.classList.remove("lp-hold");
          io.unobserve(e.target);
        });
      }, { rootMargin: "0px 0px -8% 0px", threshold: 0.08 });
      for (var i = 0; i < items.length; i++) {
        var r = items[i].getBoundingClientRect();
        if (r.top > window.innerHeight * 0.92) { items[i].classList.add("lp-hold"); io.observe(items[i]); }
      }
      var cio = new IntersectionObserver(function (entries) {
        entries.forEach(function (e) { if (e.isIntersecting) { countUp(e.target); cio.unobserve(e.target); } });
      }, { threshold: 0.6 });
      for (var c = 0; c < counters.length; c++) cio.observe(counters[c]);
    }

    /* cabeçalho ganha sombra ao rolar + barra de progresso (opcional) */
    var header = document.querySelector(".lp-header");
    var bar = null;
    if (LP.get("motion.progress", false)) { bar = document.createElement("div"); bar.className = "lp-progress"; bar.setAttribute("aria-hidden", "true"); document.body.appendChild(bar); }
    var ticking = false;
    function onScroll() {
      if (ticking) return; ticking = true;
      window.requestAnimationFrame(function () {
        ticking = false;
        if (header) header.setAttribute("data-scrolled", window.scrollY > 8 ? "true" : "false");
        if (bar) { var max = document.documentElement.scrollHeight - window.innerHeight; bar.style.setProperty("--lp-scroll", max > 0 ? String(Math.min(1, window.scrollY / max)) : "0"); }
      });
    }
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();

    /* botões: onda no clique e leve atração do cursor (data-lp-ripple / data-lp-magnet) */
    if (!reduce) {
      var rip = document.querySelectorAll("[data-lp-ripple], .lp-btn");
      for (var r = 0; r < rip.length; r++) rip[r].addEventListener("pointerdown", function (ev) {
        var b = this.getBoundingClientRect(), s = document.createElement("span");
        s.className = "lp-ripple"; s.setAttribute("aria-hidden", "true");
        s.style.left = (ev.clientX - b.left) + "px"; s.style.top = (ev.clientY - b.top) + "px";
        this.appendChild(s); s.addEventListener("animationend", function () { if (s.parentNode) s.parentNode.removeChild(s); });
      });
      var mag = document.querySelectorAll("[data-lp-magnet]");
      for (var q = 0; q < mag.length; q++) (function (el) {
        el.addEventListener("pointermove", function (ev) {
          if (ev.pointerType === "touch") return;
          var b = el.getBoundingClientRect();
          el.style.translate = (((ev.clientX - b.left) / b.width - 0.5) * 10).toFixed(1) + "px " + (((ev.clientY - b.top) / b.height - 0.5) * 8).toFixed(1) + "px";
        });
        el.addEventListener("pointerleave", function () { el.style.translate = ""; });
      })(mag[q]);
    }

    /* pausar animações contínuas (só existe se a página tiver alguma).
       Com [data-lp-motion-slot] na página (ex.: no cabeçalho), vira um ícone compacto ali dentro e não flutua sobre o conteúdo. */
    if (document.querySelector("[data-lp-loop]") && !reduce) {
      var slot = document.querySelector("[data-lp-motion-slot]");
      var btn = document.createElement("button"), ico = document.createElement("span"), txt = document.createElement("span");
      btn.type = "button"; btn.className = "lp-motion-toggle" + (slot ? " lp-motion-toggle--slot" : "");
      ico.className = "lp-motion-toggle__ico"; ico.setAttribute("aria-hidden", "true");
      txt.className = "lp-motion-toggle__txt"; txt.textContent = "Pausar animações";
      btn.appendChild(ico); btn.appendChild(txt);
      btn.setAttribute("aria-pressed", "false");
      if (slot) btn.title = txt.textContent;
      btn.addEventListener("click", function () {
        LP.motion.paused = !LP.motion.paused;
        document.documentElement.setAttribute("data-motion", LP.motion.paused ? "paused" : "running");
        btn.setAttribute("aria-pressed", LP.motion.paused ? "true" : "false");
        txt.textContent = LP.motion.paused ? "Retomar animações" : "Pausar animações";
        if (slot) btn.title = txt.textContent;
      });
      (slot || document.body).appendChild(btn);
    }
  });
})();
