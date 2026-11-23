/* LP Kit — shader.js : fundo em shader de tela cheia (WebGL cru, sem biblioteca).
   A página entrega só o fragment shader; o motor cuida do resto.

     var cena = LP.shader.mount(canvas, {
       frag: "...",        // GLSL ES 1.0. Uniforms disponíveis:
                           //   vec2 u_res (px), float u_time (s), vec2 u_mouse (-1..1, suavizado),
                           //   float u_scroll (0..1 do quanto o bloco já saiu da tela), float u_boost (0..1, decai),
                           //   float u_off (deslocamento acumulado, 0..1, anda mais rápido com boost)
       scale: 0.6,         // resolução interna relativa ao tamanho na tela (estética retrô e menos GPU)
       offRate: 0.9,       // velocidade base de u_off
       still: 12           // tempo usado no quadro estático (reduced-motion)
     });
     cena.pulse();         // dispara u_boost = 1 (ex.: um clique)

   O pai do canvas recebe data-gl="on" depois do 1º quadro, ou "off" sem WebGL/erro de shader.
   Para fora da tela, com a aba oculta ou em "Pausar animações". Com reduced-motion: um quadro estático. */
(function () {
  "use strict";
  var LP = window.LP;
  if (!LP) return;
  var VS = "attribute vec2 a; void main(){ gl_Position = vec4(a, 0.0, 1.0); }";

  function mount(canvas, spec) {
    var handle = { pulse: function () {} };
    if (!canvas) return handle;
    var wrap = canvas.parentNode, gl = null;
    try { gl = canvas.getContext("webgl", { antialias: false, alpha: false, preserveDrawingBuffer: false }) || canvas.getContext("experimental-webgl"); } catch (e) { gl = null; }
    if (!gl) { wrap.setAttribute("data-gl", "off"); return handle; }

    var prog = null, loc = {}, raf = 0, running = false, visible = true;
    var mx = 0, my = 0, tmx = 0, tmy = 0, boost = 0, off = 0, t0 = 0, last = 0;
    var scale = spec.scale || 0.6, offRate = spec.offRate == null ? 0.9 : spec.offRate;

    function compile(type, src) { var s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); return gl.getShaderParameter(s, gl.COMPILE_STATUS) ? s : null; }
    function setup() {
      var v = compile(gl.VERTEX_SHADER, VS), f = compile(gl.FRAGMENT_SHADER, spec.frag);
      if (!v || !f) return false;
      prog = gl.createProgram(); gl.attachShader(prog, v); gl.attachShader(prog, f); gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return false;
      gl.useProgram(prog);
      var b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
      var a = gl.getAttribLocation(prog, "a"); gl.enableVertexAttribArray(a); gl.vertexAttribPointer(a, 2, gl.FLOAT, false, 0, 0);
      ["u_res", "u_time", "u_mouse", "u_scroll", "u_boost", "u_off"].forEach(function (n) { loc[n] = gl.getUniformLocation(prog, n); });
      return true;
    }
    function resize() {
      var box = wrap.getBoundingClientRect(), dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      var W = Math.max(1, Math.round(box.width * dpr * scale)), H = Math.max(1, Math.round(box.height * dpr * scale));
      if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
      gl.viewport(0, 0, W, H);
      return box;
    }
    function draw(time) {
      var box = resize();
      var sc = Math.min(1, Math.max(0, -box.top / Math.max(1, box.height)));
      gl.uniform2f(loc.u_res, canvas.width, canvas.height);
      gl.uniform1f(loc.u_time, time % 3600);
      gl.uniform2f(loc.u_mouse, tmx, tmy);
      gl.uniform1f(loc.u_scroll, sc);
      gl.uniform1f(loc.u_boost, boost);
      gl.uniform1f(loc.u_off, off);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    function frame(now) {
      raf = 0;
      var dt = Math.min(0.05, (now - last) / 1000); last = now;
      tmx += (mx - tmx) * Math.min(1, dt * 3); tmy += (my - tmy) * Math.min(1, dt * 3);
      boost *= Math.pow(0.25, dt);
      off = (off + dt * offRate * (1 + boost * 5)) % 1;
      draw((now - t0) / 1000);
      if (running && visible && !LP.motion.paused && !document.hidden) raf = requestAnimationFrame(frame);
    }
    function start() {
      if (!running) { running = true; last = performance.now(); }
      if (!raf && visible && !LP.motion.paused && !LP.motion.reduced) { last = performance.now(); raf = requestAnimationFrame(frame); }
    }
    handle.pulse = function () { boost = 1; start(); };

    function init() {
      if (!setup()) { wrap.setAttribute("data-gl", "off"); return; }
      t0 = performance.now();
      draw(LP.motion.reduced ? (spec.still || 12) : 0);
      wrap.setAttribute("data-gl", "on");
      if (LP.motion.reduced) return;
      window.addEventListener("pointermove", function (ev) { mx = (ev.clientX / window.innerWidth - 0.5) * 2; my = -(ev.clientY / window.innerHeight - 0.5) * 2; }, { passive: true });
      window.addEventListener("resize", function () { draw((performance.now() - t0) / 1000); });
      if ("IntersectionObserver" in window) new IntersectionObserver(function (es) { visible = es[0].isIntersecting; if (visible) start(); }, { threshold: 0.01 }).observe(wrap);
      document.addEventListener("visibilitychange", function () { if (!document.hidden) start(); });
      new MutationObserver(function () { if (!LP.motion.paused) start(); }).observe(document.documentElement, { attributes: true, attributeFilter: ["data-motion"] });
      start();
    }
    /* depois da primeira pintura: texto e botões aparecem antes do shader compilar */
    LP.ready(function () { window.requestAnimationFrame(function () { window.setTimeout(init, 60); }); });
    return handle;
  }
  LP.shader = { mount: mount };
})();
