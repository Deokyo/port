/* LP Kit — core.js : namespace window.LP e configuração (#lp-config). Sem dependências. */
(function () {
  "use strict";
  var LP = (window.LP = window.LP || {});
  LP.version = "0.1.0-piloto";
  LP.config = {};

  var el = document.getElementById("lp-config");
  if (el) {
    try { LP.config = JSON.parse(el.textContent || "{}"); }
    catch (e) { LP.config = {}; LP.configError = true; if (window.console) console.warn("[LP] #lp-config inválido"); }
  }

  LP.get = function (path, fallback) {
    var cur = LP.config, parts = String(path).split(".");
    for (var i = 0; i < parts.length; i++) {
      if (cur == null || typeof cur !== "object") return fallback;
      cur = cur[parts[i]];
    }
    return cur == null ? fallback : cur;
  };

  LP.ready = function (fn) {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", fn, { once: true });
    else fn();
  };
})();
