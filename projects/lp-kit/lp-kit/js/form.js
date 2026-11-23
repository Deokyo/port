/* LP Kit — form.js : formulário de contato.
   - validação no cliente, mensagens por campo, foco no primeiro erro
   - envio JSON para form.endpoint; SUCESSO SÓ com HTTP 201
   - 422: erros do servidor por campo; demais status/rede/timeout: mensagem honesta + alternativa (WhatsApp/e-mail)
   - honeypot, trava contra duplo envio, região aria-live. Nenhum dado pessoal vai para eventos. */
(function () {
  "use strict";
  var LP = window.LP;

  var rules = {
    name: function (v) { return v.trim().length >= 2 ? "" : "Informe seu nome."; },
    email: function (v) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim()) ? "" : "Informe um e-mail válido."; },
    phone: function (v) { var d = v.replace(/\D/g, ""); return d.length === 0 || (d.length >= 10 && d.length <= 13) ? "" : "Telefone com DDD, só números."; },
    message: function (v) { return v.trim().length >= 10 ? "" : "Conte um pouco mais (mínimo 10 caracteres)."; },
    consent: function (v, el) { return el.checked ? "" : "Para enviar, confirme o uso dos dados."; }
  };

  function field(form, name) { return form.querySelector('[name="' + name + '"]'); }

  function setError(el, msg) {
    var wrap = el.closest(".lp-field, .lp-check");
    var err = wrap.querySelector(".lp-error");
    if (msg) {
      wrap.setAttribute("data-invalid", "true");
      el.setAttribute("aria-invalid", "true");
      if (err) { err.textContent = msg; err.hidden = false; }
    } else {
      wrap.removeAttribute("data-invalid");
      el.removeAttribute("aria-invalid");
      if (err) { err.textContent = ""; err.hidden = true; }
    }
  }

  function validate(form) {
    var first = null;
    for (var name in rules) {
      var el = field(form, name);
      if (!el) continue;
      var required = el.hasAttribute("required") || name === "consent";
      var msg = (!required && !el.value) ? "" : rules[name](el.value || "", el);
      setError(el, msg);
      if (msg && !first) first = el;
    }
    return first;
  }

  function status(box, state, html) {
    box.setAttribute("data-state", state);
    box.innerHTML = html;
  }

  function fallbackHtml() {
    var parts = [];
    if (LP.channels && LP.channels.available("whatsapp")) parts.push('<a href="' + LP.channels.url("whatsapp") + '" target="_blank" rel="noopener noreferrer">WhatsApp</a>');
    if (LP.channels && LP.channels.available("email")) parts.push('<a href="' + LP.channels.url("email") + '">e-mail</a>');
    return parts.length ? " Se preferir, fale por " + parts.join(" ou ") + "." : "";
  }

  LP.ready(function () {
    var form = document.querySelector("form[data-lp-form]");
    if (!form) return;
    var box = form.querySelector(".lp-status");
    var btn = form.querySelector('button[type="submit"]');
    var busy = false;
    form.setAttribute("novalidate", "");

    form.addEventListener("input", function (ev) {
      var n = ev.target.name;
      if (rules[n] && ev.target.closest("[data-invalid]")) {
        var msg = rules[n](ev.target.value || "", ev.target);
        if (!msg) setError(ev.target, "");
      }
    });

    form.addEventListener("submit", function (ev) {
      ev.preventDefault();
      if (busy) return;

      var hp = field(form, "website");
      if (hp && hp.value) { status(box, "success", "Recebido."); return; } /* robô: finge sucesso, não envia */

      var bad = validate(form);
      if (bad) {
        status(box, "error", "Revise os campos destacados.");
        bad.focus();
        return;
      }

      var endpoint = LP.get("form.endpoint", "");
      if (!endpoint) { status(box, "error", "Formulário indisponível no momento." + fallbackHtml()); return; }

      var payload = {};
      ["name", "email", "phone", "message"].forEach(function (n) { var el = field(form, n); if (el) payload[n] = el.value.trim(); });
      var seg = field(form, "segment"); if (seg) payload.segment = seg.value;
      payload.consent = true;

      busy = true;
      btn.disabled = true;
      btn.setAttribute("aria-busy", "true");
      status(box, "pending", "Enviando…");

      var ctrl = typeof AbortController === "function" ? new AbortController() : null;
      var timer = setTimeout(function () { if (ctrl) ctrl.abort(); }, LP.get("form.timeoutMs", 8000));

      fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Accept": "application/json" },
        body: JSON.stringify(payload),
        signal: ctrl ? ctrl.signal : undefined
      }).then(function (res) {
        if (res.status === 201) {
          form.reset();
          status(box, "success", "<strong>Mensagem enviada.</strong> Retornamos em até 1 dia útil.");
          LP.track("form_submit", { form: "contato", ok: true });
          box.setAttribute("tabindex", "-1"); box.focus();
          return;
        }
        if (res.status === 422) {
          return res.json().then(function (j) {
            var errs = (j && j.errors) || {}, first = null;
            for (var k in errs) { var el = field(form, k); if (el) { setError(el, String(errs[k])); if (!first) first = el; } }
            status(box, "error", "Revise os campos destacados.");
            if (first) first.focus();
          }, function () { status(box, "error", "Revise os campos destacados."); });
        }
        status(box, "error", "Não conseguimos enviar agora. Seus dados continuam no formulário." + fallbackHtml());
        LP.track("form_error", { status: res.status });
      }).catch(function () {
        status(box, "error", "Sem conexão com o servidor. Seus dados continuam no formulário." + fallbackHtml());
        LP.track("form_error", { status: 0 });
      }).then(function () {
        clearTimeout(timer);
        busy = false;
        btn.disabled = false;
        btn.removeAttribute("aria-busy");
      });
    });
  });
})();
