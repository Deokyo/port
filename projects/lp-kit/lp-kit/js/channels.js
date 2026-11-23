/* LP Kit — channels.js : monta os links dos canais a partir do #lp-config.
   Elementos usam data-lp-channel="whatsapp|phone|email|directions|scheduling".
   Canal sem configuração válida: o elemento é ocultado (nunca fica um botão quebrado). */
(function () {
  "use strict";
  var LP = window.LP;

  function digits(s) { return String(s || "").replace(/\D/g, ""); }

  var builders = {
    whatsapp: function (el) {
      var num = digits(LP.get("channels.whatsapp.number", ""));
      if (num.length < 10 || num.length > 15) return null;
      var msg = el.getAttribute("data-lp-message") || LP.get("channels.whatsapp.message", "");
      return "https://wa.me/" + num + (msg ? "?text=" + encodeURIComponent(msg) : "");
    },
    phone: function () {
      var n = digits(LP.get("channels.phone", ""));
      return n.length >= 8 ? "tel:+" + n : null;
    },
    email: function () {
      var m = String(LP.get("channels.email", ""));
      return /^[^\s@]+@[^\s@]+$/.test(m) ? "mailto:" + m : null;
    },
    directions: function () {
      var q = LP.get("channels.directions.query", "");
      return q ? "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(q) : null;
    },
    scheduling: function () {
      var u = String(LP.get("channels.scheduling.url", ""));
      return /^https:\/\//.test(u) ? u : null;
    }
  };

  LP.channels = {
    url: function (name, el) { return builders[name] ? builders[name](el || document.createElement("a")) : null; },
    available: function (name) { return !!LP.channels.url(name); },
    /* recalcula o href de um elemento (ex.: depois que a mensagem mudou) */
    refresh: function (el) {
      var url = LP.channels.url(el.getAttribute("data-lp-channel"), el);
      if (url) el.setAttribute("href", url);
    }
  };

  LP.ready(function () {
    var nodes = document.querySelectorAll("[data-lp-channel]");
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      var name = el.getAttribute("data-lp-channel");
      var url = LP.channels.url(name, el);
      if (!url) { el.hidden = true; continue; }
      el.setAttribute("href", url);
      if (/^https?:/.test(url)) { el.setAttribute("target", "_blank"); el.setAttribute("rel", "noopener noreferrer"); }
    }
  });
})();
