/* LP Kit — gl.js : motor de WebGL cru (sem biblioteca) para heros de pontos de luz e linhas.
   O segundo argumento pode ser uma função que devolve a descrição (assim a geometria só é montada depois da primeira pintura).
   A página só descreve a geometria; o motor cuida de shaders, câmera, mouse, scroll, pausa e fallback.

     LP.gl.mount(canvas, {
       groups: [{ points: [x,y,z, r,g,b,a, tamanho, ...], lines: [x,y,z,r,g,b,a,0, ...(2 vértices por segmento)],
                  spin: true,   // gira em torno do eixo Z
                  drift: 0,     // sobe devagar e dá a volta (unidades por segundo)
                  tilt: 1 }],   // quanto acompanha o mouse (0 = fica parado)
       rotX: -0.18, rotY: -0.5, // inclinação base
       mouseX: 0.4, mouseY: 0.3, // quanto o mouse inclina
       spinSpeed: 0.32, scrollBoost: 0.6  // giro base e aceleração pelo scroll
     });

   O contêiner (pai do canvas) recebe data-gl="on" ou "off" (sem WebGL: estilize o fallback por CSS).
   Com reduced-motion desenha um quadro estático. Para quando sai da tela, com a aba oculta ou em "Pausar animações". */
(function () {
  "use strict";
  var LP = window.LP;
  if (!LP) return;

  var VS = "attribute vec3 p; attribute vec4 c; attribute float s; uniform mat4 m; uniform float dpr; uniform float k; uniform vec2 asp; varying vec4 vc;" +
    "void main(){ vec4 q = m * vec4(p,1.0); float w = 3.2 - q.z; gl_Position = vec4(q.x * 2.4 * asp.x / w, q.y * 2.4 * asp.y / w, q.z * 0.1, 1.0);" +
    "gl_PointSize = s * dpr * k * (3.2 / w); float d = clamp((q.z + 1.2) / 2.4, 0.0, 1.0); vc = vec4(c.rgb, c.a * (0.35 + 0.65 * d)); }";
  var FS_P = "precision mediump float; varying vec4 vc; void main(){ vec2 d = gl_PointCoord - 0.5; float r = length(d) * 2.0; if (r > 1.0) discard;" +
    "float a = pow(1.0 - r, 1.1); gl_FragColor = vec4(vc.rgb * (0.8 + 0.6 * a), min(1.0, vc.a * a * 1.5)); }";
  var FS_L = "precision mediump float; varying vec4 vc; void main(){ gl_FragColor = vc; }";

  function mount(canvas, specOrBuild) {
    if (!canvas) return;
    var spec = null; /* pode ser uma função: a geometria só é montada depois da primeira pintura */
    var wrap = canvas.parentNode, gl = null;
    try { gl = canvas.getContext("webgl", { antialias: true, alpha: true, premultipliedAlpha: false }) || canvas.getContext("experimental-webgl"); } catch (e) { gl = null; }
    if (!gl) { wrap.setAttribute("data-gl", "off"); return; }

    function sh(type, src) { var s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); return gl.getShaderParameter(s, gl.COMPILE_STATUS) ? s : null; }
    function prog(fs) {
      var v = sh(gl.VERTEX_SHADER, VS), f = sh(gl.FRAGMENT_SHADER, fs);
      if (!v || !f) return null;
      var pr = gl.createProgram(); gl.attachShader(pr, v); gl.attachShader(pr, f); gl.linkProgram(pr);
      return gl.getProgramParameter(pr, gl.LINK_STATUS) ? pr : null;
    }
    var pP = prog(FS_P), pL = prog(FS_L);
    if (!pP || !pL) { wrap.setAttribute("data-gl", "off"); return; }

    function buf(arr) { var b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(arr), gl.STATIC_DRAW); return b; }
    var groups = [], rotX, rotY, mouseX, mouseY, spinSpeed, scrollBoost;
    function setup() {
      spec = typeof specOrBuild === "function" ? specOrBuild() : specOrBuild;
      groups = (spec.groups || []).map(function (g) {
      return { spin: !!g.spin, drift: g.drift || 0, tilt: g.tilt == null ? 1 : g.tilt,
        bP: g.points && g.points.length ? buf(g.points) : null, nP: g.points ? g.points.length / 8 : 0,
        bL: g.lines && g.lines.length ? buf(g.lines) : null, nL: g.lines ? g.lines.length / 8 : 0 };
      });
      rotX = spec.rotX == null ? -0.18 : spec.rotX; rotY = spec.rotY == null ? -0.5 : spec.rotY;
      mouseX = spec.mouseX == null ? 0.4 : spec.mouseX; mouseY = spec.mouseY == null ? 0.3 : spec.mouseY;
      spinSpeed = spec.spinSpeed == null ? 0.32 : spec.spinSpeed; scrollBoost = spec.scrollBoost == null ? 0.6 : spec.scrollBoost;
    }

    function bind(pr, b) {
      gl.useProgram(pr); gl.bindBuffer(gl.ARRAY_BUFFER, b);
      var ap = gl.getAttribLocation(pr, "p"), ac = gl.getAttribLocation(pr, "c"), as = gl.getAttribLocation(pr, "s");
      gl.enableVertexAttribArray(ap); gl.vertexAttribPointer(ap, 3, gl.FLOAT, false, 32, 0);
      gl.enableVertexAttribArray(ac); gl.vertexAttribPointer(ac, 4, gl.FLOAT, false, 32, 12);
      if (as >= 0) { gl.enableVertexAttribArray(as); gl.vertexAttribPointer(as, 1, gl.FLOAT, false, 32, 28); }
    }
    function mat(spin, tx, ty) {
      var cz = Math.cos(spin), sz = Math.sin(spin), cy = Math.cos(ty), sy = Math.sin(ty), cx = Math.cos(tx), sx = Math.sin(tx);
      return new Float32Array([cy * cz, sx * sy * cz + cx * sz, -cx * sy * cz + sx * sz, 0, -cy * sz, -sx * sy * sz + cx * cz, cx * sy * sz + sx * cz, 0, sy, -sx * cy, cx * cy, 0, 0, 0, 0, 1]);
    }

    var dpr = 1, W = 0, H = 0;
    function resize() {
      var box = wrap.getBoundingClientRect();
      dpr = Math.min(window.devicePixelRatio || 1, window.innerWidth < 700 ? 1.5 : 2);
      W = Math.max(1, Math.round(box.width * dpr)); H = Math.max(1, Math.round(box.height * dpr));
      if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
      gl.viewport(0, 0, W, H);
    }

    var mx = 0, my = 0, tmx = 0, tmy = 0, spin = 0.4, boost = 0, lastY = window.scrollY, t0 = performance.now(), running = false, visible = true, raf = 0;
    function draw(time) {
      resize();
      gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
      gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
      var asp = W > H ? [H / W, 1] : [1, W / H], k = Math.min(W, H) / 330;
      function uni(pr, mm) { gl.uniformMatrix4fv(gl.getUniformLocation(pr, "m"), false, mm); gl.uniform1f(gl.getUniformLocation(pr, "dpr"), dpr); gl.uniform1f(gl.getUniformLocation(pr, "k"), k); gl.uniform2f(gl.getUniformLocation(pr, "asp"), asp[0], asp[1]); }
      groups.forEach(function (g) {
        var m = mat(g.spin ? spin : 0, rotX + tmy * mouseY * g.tilt, rotY + tmx * mouseX * g.tilt);
        if (g.drift) m[13] = ((time * g.drift) % 1.3) - 0.65;
        if (g.bL) { bind(pL, g.bL); uni(pL, m); gl.drawArrays(gl.LINES, 0, g.nL); }
        if (g.bP) { bind(pP, g.bP); uni(pP, m); gl.drawArrays(gl.POINTS, 0, g.nP); }
      });
    }
    function frame(now) {
      raf = 0;
      var dt = Math.min(0.05, (now - t0) / 1000); t0 = now;
      tmx += (mx - tmx) * Math.min(1, dt * 4); tmy += (my - tmy) * Math.min(1, dt * 4);
      var sy = window.scrollY; boost = boost * Math.pow(0.04, dt) + Math.min(6, Math.abs(sy - lastY) * 0.02); lastY = sy;
      spin += dt * (spinSpeed + boost * scrollBoost);
      draw(now / 1000);
      if (running && visible && !LP.motion.paused && !document.hidden) raf = requestAnimationFrame(frame);
    }
    function start() { if (!running) { running = true; t0 = performance.now(); } if (!raf && visible && !LP.motion.paused && !LP.motion.reduced) raf = requestAnimationFrame(frame); }

    function init() {
      setup();
      resize(); wrap.setAttribute("data-gl", "on");
      draw(0);
      if (LP.motion.reduced) return; /* quadro estático */
      window.addEventListener("pointermove", function (ev) { var b = wrap.getBoundingClientRect(); mx = ((ev.clientX - b.left) / b.width - 0.5) * 2; my = ((ev.clientY - b.top) / b.height - 0.5) * 2; }, { passive: true });
      window.addEventListener("resize", function () { draw(performance.now() / 1000); });
      if ("IntersectionObserver" in window) new IntersectionObserver(function (es) { visible = es[0].isIntersecting; if (visible) start(); }, { threshold: 0.01 }).observe(wrap);
      document.addEventListener("visibilitychange", function () { if (!document.hidden) start(); });
      new MutationObserver(function () { if (!LP.motion.paused) start(); }).observe(document.documentElement, { attributes: true, attributeFilter: ["data-motion"] });
      start();
    }
    /* depois da primeira pintura: o texto e o botão aparecem antes do desenho */
    LP.ready(function () { window.requestAnimationFrame(function () { window.setTimeout(init, 60); }); });
  }

  LP.gl = { mount: mount };
})();
