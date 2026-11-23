/* LP Kit — slides.js : vitrine que passa para o lado (par do slides.css).
   [data-lp-slides]                 raiz
     .lp-slides__track              faixa com scroll-snap; cada filho é um slide (data-lp-label = nome curto)
     .lp-slides__bar[hidden]        só aparece com JS
       [data-lp-slides-prev] / [data-lp-slides-next]
       [data-lp-slides-count]       recebe "01 / 04" (aria-live)
       [data-lp-slides-dots]        recebe um botão por slide
   Teclado: com a faixa em foco, ← → Home End. Dedo e roda: rolagem nativa.
   Ao trocar: slide ativo ganha .is-on (os outros ficam aria-hidden, para o leitor de tela anunciar só o atual), a raiz recebe o evento "lp:slide" com { index }. Volta ao início depois do último. */
(function () {
  "use strict";
  var LP = window.LP;
  if (!LP) return;
  var pad = function (n) { return (n < 10 ? "0" : "") + n; };

  function mount(root) {
    var track = root.querySelector(".lp-slides__track");
    var slides = track ? Array.prototype.slice.call(track.children) : [];
    if (slides.length < 2) return;
    var bar = root.querySelector(".lp-slides__bar");
    var count = root.querySelector("[data-lp-slides-count]");
    var dotsBox = root.querySelector("[data-lp-slides-dots]");
    var reduce = LP.motion && LP.motion.reduced;
    var cur = -1, dots = [];

    slides.forEach(function (s, i) {
      s.setAttribute("role", "group");
      s.setAttribute("aria-roledescription", "slide");
      s.setAttribute("aria-label", (i + 1) + " de " + slides.length + (s.dataset.lpLabel ? ": " + s.dataset.lpLabel : ""));
      if (dotsBox) {
        var b = document.createElement("button");
        b.type = "button"; b.className = "lp-slides__dot";
        b.setAttribute("aria-label", "Ir para " + (s.dataset.lpLabel || "item " + (i + 1)));
        b.addEventListener("click", function () { go(i); });
        dotsBox.appendChild(b); dots.push(b);
      }
    });

    function step() { return slides[1].offsetLeft - slides[0].offsetLeft; }
    function go(i) {
      i = (i + slides.length) % slides.length;
      track.scrollTo({ left: slides[i].offsetLeft - slides[0].offsetLeft, behavior: reduce ? "auto" : "smooth" });
      set(i);
    }
    function set(i) {
      if (i === cur) return;
      cur = i;
      slides.forEach(function (s, k) { s.classList.toggle("is-on", k === i); if (k === i) s.removeAttribute("aria-hidden"); else s.setAttribute("aria-hidden", "true"); });
      dots.forEach(function (d, k) { if (k === i) d.setAttribute("aria-current", "true"); else d.removeAttribute("aria-current"); });
      if (count) count.innerHTML = "<b>" + pad(i + 1) + "</b> / " + pad(slides.length);
      root.dispatchEvent(new CustomEvent("lp:slide", { detail: { index: i } }));
    }

    var raf = 0;
    track.addEventListener("scroll", function () {
      if (raf) return;
      raf = requestAnimationFrame(function () {
        raf = 0;
        var i = Math.round(track.scrollLeft / step());
        set(Math.max(0, Math.min(slides.length - 1, i)));
      });
    }, { passive: true });

    track.addEventListener("keydown", function (e) {
      var k = e.key, to = null;
      if (k === "ArrowRight") to = cur + 1; else if (k === "ArrowLeft") to = cur - 1;
      else if (k === "Home") to = 0; else if (k === "End") to = slides.length - 1;
      if (to === null) return;
      e.preventDefault(); go(to);
    });
    var prev = root.querySelector("[data-lp-slides-prev]"), next = root.querySelector("[data-lp-slides-next]");
    if (prev) prev.addEventListener("click", function () { go(cur - 1); });
    if (next) next.addEventListener("click", function () { go(cur + 1); });

    if (bar) bar.hidden = false;
    root.classList.add("is-ready");
    set(0);
    root.lpSlides = { go: go, get index() { return cur; } };
  }

  LP.slides = { mount: mount };
  var start = function () { document.querySelectorAll("[data-lp-slides]").forEach(mount); };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
})();
