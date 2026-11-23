/* LP Kit — compose.js : o visitante escolhe opções (dia, pessoas…) e a mensagem do canal é montada sozinha.
   Marcação: <div data-lp-compose data-lp-template="Olá! Quero {dia} para {pessoas}.">
               <input type="radio" name="dia" value="sexta"> … 
               <p data-lp-compose-preview></p>
               <a data-lp-channel="whatsapp" data-lp-compose-target>…</a></div>
   Escolhas ainda vazias viram "(a combinar)"; com {nome?} a parte opcional some se nada for escolhido. Eventos não carregam o conteúdo escolhido. */
(function () {
  "use strict";
  var LP = window.LP;

  LP.ready(function () {
    var boxes = document.querySelectorAll("[data-lp-compose]");
    for (var i = 0; i < boxes.length; i++) (function (box) {
      var tpl = box.getAttribute("data-lp-template") || "";
      var target = box.querySelector("[data-lp-compose-target]");
      var preview = box.querySelector("[data-lp-compose-preview]");
      var asked = false;

      function build() {
        return tpl.replace(/\{(\w+)(\?)?\}/g, function (_, name, optional) {
          var el = box.querySelector('input[name="' + name + '"]:checked');
          if (el) return el.value;
          return optional ? "" : "(a combinar)";
        }).replace(/\s+$/, "");
      }
      function update() {
        var msg = build();
        if (target) { target.setAttribute("data-lp-message", msg); if (LP.channels && LP.channels.refresh) LP.channels.refresh(target); }
        if (preview) preview.textContent = msg;
      }
      box.addEventListener("change", function () { update(); if (!asked) { asked = true; LP.track("compose_start", {}); } });
      update();
    })(boxes[i]);
  });
})();
