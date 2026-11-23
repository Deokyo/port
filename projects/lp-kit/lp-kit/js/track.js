/* LP Kit — track.js : eventos com portão de consentimento.
   Padrão: tracking.enabled = false (nada é emitido, nada é carregado).
   Quando ligado e consentRequired = true, eventos antes do aceite são DESCARTADOS (não enfileirados).
   Este módulo nunca carrega GTM/Umami/RD: só empurra para window.dataLayer; quem instala
   o container é decisão de cada cliente e fica fora do kit. Sem dados pessoais nos eventos. */
(function () {
  "use strict";
  var LP = window.LP;
  var KEY = "lp_consent";
  var mem = null;

  function read() {
    if (mem) return mem;
    try { return window.localStorage.getItem(KEY); } catch (e) { return null; }
  }
  function write(v) {
    mem = v;
    try { window.localStorage.setItem(KEY, v); } catch (e) { /* storage bloqueado: vale só nesta visita */ }
  }

  var BLOCKED_KEYS = /name|nome|mail|phone|fone|tel|message|mensagem|cpf|cnpj|value/i;
  function clean(params) {
    var out = {};
    for (var k in params) {
      if (Object.prototype.hasOwnProperty.call(params, k) && !BLOCKED_KEYS.test(k)) {
        var v = params[k];
        if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") out[k] = v;
      }
    }
    return out;
  }

  LP.consent = {
    state: function () { var v = read(); return v === "granted" || v === "denied" ? v : "unset"; },
    grant: function () { write("granted"); },
    deny: function () { write("denied"); },
    allowed: function () {
      if (!LP.get("tracking.enabled", false)) return false;
      if (!LP.get("tracking.consentRequired", true)) return true;
      return LP.consent.state() === "granted";
    }
  };

  LP.track = function (name, params) {
    if (!LP.consent.allowed()) return false;
    var evt = clean(params || {});
    evt.event = "lp_" + name;
    evt.lp_profile = LP.get("profile", "");
    window.dataLayer = window.dataLayer || [];
    window.dataLayer.push(evt);
    return true;
  };

  LP.ready(function () {
    if (!LP.get("tracking.enabled", false) || !LP.get("tracking.consentRequired", true)) return;
    if (LP.consent.state() !== "unset") return;

    var box = document.createElement("div");
    box.className = "lp-consent";
    box.setAttribute("role", "region");
    box.setAttribute("aria-label", "Aviso de medição");
    box.innerHTML =
      '<p>Usamos medição anônima para melhorar esta página. Você escolhe se aceita.</p>' +
      '<div class="lp-actions">' +
      '<button type="button" class="lp-btn" data-lp-consent="granted">Aceitar</button>' +
      '<button type="button" class="lp-btn lp-btn--ghost" data-lp-consent="denied">Recusar</button>' +
      "</div>";
    box.addEventListener("click", function (ev) {
      var b = ev.target.closest("[data-lp-consent]");
      if (!b) return;
      if (b.getAttribute("data-lp-consent") === "granted") LP.consent.grant(); else LP.consent.deny();
      box.remove();
    });
    document.body.appendChild(box);
  });
})();
