/* Noctua (demo): cena retrô em shader (sol listrado, cidade com janelas, chão de grade que corre),
   ficha com som (só por clique), placar que rola e brilho que segue o cursor nos cartões. */
(function () {
  "use strict";
  var LP = window.LP;
  if (!LP) return;

  var FRAG = [
    "#ifdef GL_FRAGMENT_PRECISION_HIGH", "precision highp float;", "#else", "precision mediump float;", "#endif",
    "uniform vec2 u_res; uniform float u_time; uniform vec2 u_mouse; uniform float u_scroll; uniform float u_boost; uniform float u_off;",
    "float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }",
    "void main(){",
    "  vec2 uv = (gl_FragCoord.xy - 0.5 * u_res) / u_res.y;",
    "  float asp = u_res.x / u_res.y;",
    "  float port = step(asp, 1.0);",
    "  float h = mix(-0.1, -0.3, port) + u_mouse.y * 0.015 - u_scroll * 0.08;",
    "  float sy = uv.y - h;",
    /* céu */
    "  vec3 col = mix(vec3(0.33, 0.08, 0.30), vec3(0.10, 0.06, 0.24), smoothstep(0.0, 0.22, sy));",
    "  col = mix(col, vec3(0.015, 0.012, 0.04), smoothstep(0.18, 0.62, sy));",
    /* estrelas */
    "  vec2 sg = floor(uv * 80.0); float st = hash(sg);",
    "  float sd = length(fract(uv * 80.0) - 0.5);",
    "  float star = step(0.986, st) * smoothstep(0.22, 0.0, sd) * smoothstep(0.1, 0.35, sy);",
    "  col += vec3(0.85, 0.9, 1.0) * star * (0.55 + 0.45 * sin(u_time * 2.3 + st * 90.0));",
    /* sol listrado */
    "  vec2 sc = vec2(mix(asp * 0.2, asp * 0.22, port) + u_mouse.x * 0.025, mix(h + 0.2, 0.3, port));",
    "  float r = mix(0.24, 0.15, port); float d = length(uv - sc);",
    "  float sunIn = smoothstep(r, r - 0.004, d) * step(h, uv.y);",
    "  float tt = clamp((uv.y - (sc.y - r)) / (2.0 * r), 0.0, 1.0);",
    "  vec3 sunCol = mix(vec3(1.0, 0.22, 0.45), vec3(1.0, 0.8, 0.32), tt);",
    "  float band = sc.y + 0.03 - uv.y;",
    "  float gap = clamp(band / r, 0.0, 1.0) * 0.6;",
    "  float slit = band > 0.0 ? step(gap, fract(band * 26.0 + u_time * 0.35)) : 1.0;",
    "  col = mix(col, sunCol, sunIn * slit);",
    "  col += vec3(1.0, 0.42, 0.35) * 0.32 * exp(-max(d - r, 0.0) * 8.0) * step(h, uv.y);",
    /* cidade com janelas */
    "  float px = uv.x - u_mouse.x * 0.05;",
    "  float bx = floor(px * 16.0); float bh = 0.015 + pow(hash(vec2(bx, 3.0)), 2.0) * 0.17;",
    "  if (sy > 0.0 && sy < bh) {",
    "    col = vec3(0.028, 0.022, 0.075);",
    "    vec2 wc = floor(vec2(px * 160.0, sy * 160.0)); float wl = hash(wc);",
    "    float on = step(0.82, wl) * step(0.35, fract(wl * 7.0 + u_time * 0.03 * (0.5 + hash(wc + 1.0))));",
    "    vec2 wf = fract(vec2(px * 160.0, sy * 160.0));",
    "    float win = on * step(0.25, wf.x) * step(wf.x, 0.75) * step(0.3, wf.y) * step(wf.y, 0.8);",
    "    col += mix(vec3(1.0, 0.7, 0.28), vec3(0.37, 0.95, 1.0), step(0.93, wl)) * win * 0.9;",
    "  }",
    /* chão de grade */
    "  if (sy < 0.0) {",
    "    float fy = -sy;",
    "    float z = 0.32 / max(fy, 0.0015);",
    "    float xw = uv.x * z;",
    "    float gz = abs(fract(z + u_off) - 0.5);",
    "    float gx = abs(fract(xw * 1.1 + u_mouse.x * 0.3) - 0.5);",
    "    float wz = clamp(0.012 * z, 0.02, 0.5); float wx = clamp(0.01 * z, 0.02, 0.5);",
    "    float lz = 1.0 - smoothstep(0.0, wz, 0.5 - gz);",
    "    float lx = 1.0 - smoothstep(0.0, wx, 0.5 - gx);",
    "    float fade = smoothstep(0.0, 0.22, fy);",
    "    col = vec3(0.03, 0.018, 0.08);",
    "    col += vec3(0.37, 0.95, 1.0) * max(lz, lx) * fade * (1.15 + u_boost * 0.9);",
    "    col += vec3(1.0, 0.45, 0.45) * exp(-abs(uv.x - sc.x) * 7.0) * exp(-fy * 7.0) * 0.28 * (0.6 + 0.4 * sin(fy * 140.0 - u_time * 3.0));",
    "    col += vec3(0.6, 0.18, 0.5) * exp(-fy * 16.0) * 0.7;",
    "  }",
    "  col += vec3(1.0, 0.55, 0.65) * exp(-abs(sy) * 260.0) * 0.9;",
    "  col += vec3(1.0, 0.72, 0.35) * u_boost * 0.12;",
    "  col *= 1.0 - 0.3 * dot(uv * vec2(0.7, 1.0), uv * vec2(0.7, 1.0));",
    "  gl_FragColor = vec4(col, 1.0);",
    "}"
  ].join("\n");

  var cena = LP.shader ? LP.shader.mount(document.getElementById("nx-gl"), { frag: FRAG, scale: 0.6, offRate: 0.9, still: 14 }) : { pulse: function () {} };

  LP.ready(function () {
    var reduce = LP.motion && LP.motion.reduced;

    /* ---- placar que rola (termina no texto original) ---- */
    if (!reduce) {
      var cells = document.querySelectorAll(".nx-score li span:last-child");
      Array.prototype.forEach.call(cells, function (el, i) {
        var final = el.textContent, target = parseInt(final.replace(/\D/g, ""), 10), digits = final.replace(/\D/g, "").length;
        if (isNaN(target)) return;
        var t0 = null, delay = 900 + i * 150, dur = 1100;
        function fmt(v) { var s = String(Math.round(v)); while (s.length < digits) s = "0" + s; return s.slice(0, digits - 3) + "." + s.slice(-3); }
        el.textContent = fmt(0);
        function frame(t) {
          if (t0 === null) t0 = t;
          var p = Math.min(1, Math.max(0, (t - t0 - delay) / dur)), e = 1 - Math.pow(1 - p, 3);
          el.textContent = p < 1 ? fmt(target * e) : final;
          if (p < 1) window.requestAnimationFrame(frame);
        }
        window.requestAnimationFrame(frame);
      });
    }

    /* ---- vitrine: número de letras do nome, para a digitação ter um passo por letra ---- */
    Array.prototype.forEach.call(document.querySelectorAll(".nx-slide"), function (s) {
      var h = s.querySelector("h3");
      if (h) s.style.setProperty("--n", h.textContent.trim().length);
    });

    /* ---- ficha: som de moeda sintetizado (só por clique), créditos e chão acelerando ---- */
    var coin = document.querySelector("[data-nx-coin]");
    var credits = document.querySelector("[data-nx-credits]");
    var hero = document.querySelector(".nx-hero");
    var n = 0, ctx = null, AC = window.AudioContext || window.webkitAudioContext;
    function blip() {
      if (!AC) return;
      try {
        if (!ctx) ctx = new AC();
        if (ctx.state === "suspended") ctx.resume();
        var t = ctx.currentTime + 0.01, g = ctx.createGain(), o = ctx.createOscillator();
        o.type = "square"; o.connect(g); g.connect(ctx.destination);
        o.frequency.setValueAtTime(988, t); o.frequency.setValueAtTime(1319, t + 0.08);
        g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.12, t + 0.01);
        g.gain.setValueAtTime(0.12, t + 0.08); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.42);
        o.start(t); o.stop(t + 0.45);
      } catch (e) { /* sem som: o resto continua */ }
    }
    if (coin) coin.addEventListener("click", function () {
      n = Math.min(99, n + 1);
      blip();
      cena.pulse();
      if (credits) credits.textContent = (n < 10 ? "0" : "") + n;
      if (hero && !reduce) { hero.classList.remove("nx-flash"); void hero.offsetWidth; hero.classList.add("nx-flash"); }
      if (n >= 3 && hero) hero.classList.add("nx-ready");
    });
  });
})();
