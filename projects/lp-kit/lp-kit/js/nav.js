/* LP Kit — nav.js : menu móvel acessível (aria-expanded, Esc fecha, fecha ao navegar). */
(function () {
  "use strict";
  var LP = window.LP;

  LP.ready(function () {
    var nav = document.querySelector(".lp-nav");
    if (!nav) return;
    var toggle = nav.querySelector(".lp-nav__toggle");
    if (!toggle) return;

    function set(open) {
      nav.setAttribute("data-open", open ? "true" : "false");
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
    }
    set(false);

    toggle.addEventListener("click", function () { set(toggle.getAttribute("aria-expanded") !== "true"); });
    document.addEventListener("keydown", function (ev) {
      if (ev.key === "Escape" && toggle.getAttribute("aria-expanded") === "true") { set(false); toggle.focus(); }
    });
    nav.addEventListener("click", function (ev) { if (ev.target.closest("a")) set(false); });
  });
})();
