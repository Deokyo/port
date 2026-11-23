/* LP Kit — chat.js : conversa simulada clicável (par do chat.css).
   - Botão [data-lp-sound="perfil"]: toca um som SIMULADO, sintetizado na hora (Web Audio, sem arquivo).
     Só toca por clique do visitante; nunca sozinho. Perfil embutido: "chain" (corrente seca).
     Novo perfil: LP.chat.profiles.nome = { length: 4, schedule: function (ctx, master, t0, noise) { ... } }
     (registre antes do DOM ficar pronto; os nós criados devem ser empurrados em ctx.__nodes para o "parar").
   - [data-lp-replay]: reinicia a sequência de mensagens. */
(function () {
  "use strict";
  var LP = window.LP;
  if (!LP) return;
  var chain = {
    length: 4,
    schedule: function (c, master, t0, noise, nodes) {
      var buf = noise(0.5), t = t0, i = 0;
      /* estalos da corrente: rajadas curtas de ruído filtrado, em ritmo de pedalada com pequenas falhas */
      while (t < t0 + this.length) {
        var src = c.createBufferSource(), bp = c.createBiquadFilter(), g = c.createGain();
        src.buffer = buf; bp.type = "bandpass"; bp.frequency.value = 2200 + Math.random() * 1800; bp.Q.value = 3 + Math.random() * 3;
        var peak = (i % 4 === 0 ? 0.9 : 0.55) * (0.8 + Math.random() * 0.3);
        g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(peak, t + 0.004); g.gain.exponentialRampToValueAtTime(0.001, t + 0.06);
        src.connect(bp); bp.connect(g); g.connect(master); src.start(t, Math.random() * 0.3, 0.08); nodes.push(src);
        t += 0.11 + Math.random() * 0.05 + (i % 8 === 7 ? 0.09 : 0); i++;
      }
      /* atrito contínuo e grave, baixinho */
      var gs = c.createBufferSource(), lp = c.createBiquadFilter(), gg = c.createGain();
      gs.buffer = noise(this.length); lp.type = "lowpass"; lp.frequency.value = 900; gg.gain.setValueAtTime(0, t0);
      gg.gain.linearRampToValueAtTime(0.09, t0 + 0.4); gg.gain.setValueAtTime(0.09, t0 + this.length - 0.4); gg.gain.linearRampToValueAtTime(0, t0 + this.length);
      gs.connect(lp); lp.connect(gg); gg.connect(master); gs.start(t0); gs.stop(t0 + this.length); nodes.push(gs);
    }
  };
  LP.chat = { profiles: { chain: chain } };

  LP.ready(function () {
    var chat = document.querySelector(".lp-chat");
    if (!chat) return;

    /* ---- rever conversa ---- */
    var replay = document.querySelector("[data-lp-replay]");
    if (replay) replay.addEventListener("click", function () {
      chat.classList.add("lp-restart");
      void chat.offsetWidth; /* força o recálculo para as animações recomeçarem */
      chat.classList.remove("lp-restart");
    });

    /* ---- som simulado ---- */
    var btn = chat.querySelector("[data-lp-sound]");
    if (!btn) return;
    var profile = LP.chat.profiles[btn.getAttribute("data-lp-sound") || "chain"];
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!profile || !AC) { btn.hidden = true; return; }
    var dur = chat.querySelector(".lp-dur");
    var idleText = dur ? dur.textContent : "";
    var labelOn = btn.getAttribute("data-lp-label-on") || "Parar o som de exemplo";
    var labelOff = btn.getAttribute("aria-label");
    var ctx = null, playing = false, timer = 0, stopAt = 0, nodes = [];
    var LEN = profile.length;

    function noise(seconds) {
      var n = Math.floor(ctx.sampleRate * seconds), b = ctx.createBuffer(1, n, ctx.sampleRate), d = b.getChannelData(0);
      for (var i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
      return b;
    }
    function stop() {
      playing = false; window.clearInterval(timer);
      nodes.forEach(function (n) { try { if (n.stop) n.stop(); n.disconnect(); } catch (e) { /* já parado */ } });
      nodes = [];
      chat.classList.remove("lp-playing"); btn.setAttribute("aria-pressed", "false"); btn.setAttribute("aria-label", labelOff);
      if (dur) dur.textContent = idleText;
    }
    btn.addEventListener("click", function () {
      if (playing) { stop(); return; }
      try {
        if (!ctx) ctx = new AC();
        if (ctx.state === "suspended") ctx.resume();
        var master = ctx.createGain(); master.gain.value = 0.5; master.connect(ctx.destination); nodes.push(master);
        profile.schedule(ctx, master, ctx.currentTime + 0.05, noise, nodes);
      } catch (e) { btn.hidden = true; return; }
      playing = true; stopAt = Date.now() + LEN * 1000 + 100;
      chat.classList.add("lp-playing"); btn.setAttribute("aria-pressed", "true"); btn.setAttribute("aria-label", labelOn);
      timer = window.setInterval(function () {
        var left = stopAt - Date.now();
        if (left <= 0) { stop(); return; }
        if (dur) dur.textContent = "0:0" + Math.min(LEN, Math.floor((LEN * 1000 - left + 100) / 1000));
      }, 200);
    });
  });
})();
