/* Rodante (demo): descreve a roda de bicicleta (pneu, aro, raios, cubo e brasas); o motor é o gl.js do kit.
   O mouse inclina, o scroll acelera o giro. Sem WebGL o CSS do tema mostra um anel no lugar. */
(function () {
  "use strict";
  var LP = window.LP;
  if (!LP || !LP.gl) return;
  var canvas = document.getElementById("rd-gl");
  if (!canvas) return;

  LP.gl.mount(canvas, function () {
    /* pseudo-aleatório determinístico: a mesma roda em toda visita */
    var seed = 7; function rnd() { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; }
    var ORANGE = [1.0, 0.36, 0.12], WARM = [1.0, 0.82, 0.62], STEEL = [0.62, 0.68, 0.72];

    var pts = [], lns = [];
    function pt(x, y, z, col, a, size) { pts.push(x, y, z, col[0], col[1], col[2], a, size); }
    var i, k, a, r, t;
    /* pneu: toro com marcas de banda de rodagem */
    for (i = 0; i < 3400; i++) {
      a = rnd() * Math.PI * 2; t = rnd() * Math.PI * 2; var tr = 0.055 * (0.75 + 0.25 * Math.sin(a * 72));
      r = 0.97 + tr * Math.cos(t);
      pt(r * Math.cos(a), r * Math.sin(a), tr * Math.sin(t) * 1.8, ORANGE, 0.7, 2.2 + rnd() * 1.6);
    }
    /* aro: anel brilhante */
    for (i = 0; i < 520; i++) { a = i / 520 * Math.PI * 2; pt(0.86 * Math.cos(a), 0.86 * Math.sin(a), 0, WARM, 0.95, 3.2); pt(0.86 * Math.cos(a), 0.86 * Math.sin(a), 0.045, STEEL, 0.5, 2.2); pt(0.86 * Math.cos(a), 0.86 * Math.sin(a), -0.045, STEEL, 0.5, 2.2); }
    /* raios: 36, cruzados (laçamento), linhas + pontos */
    for (k = 0; k < 36; k++) {
      var side = k % 2 ? 1 : -1, a0 = k / 36 * Math.PI * 2, tang = 0.17 * (k % 4 < 2 ? 1 : -1);
      var hx = 0.09 * Math.cos(a0 + tang), hy = 0.09 * Math.sin(a0 + tang), hz = 0.07 * side;
      var rx = 0.86 * Math.cos(a0), ry = 0.86 * Math.sin(a0);
      lns.push(hx, hy, hz, STEEL[0], STEEL[1], STEEL[2], 0.85, 0, rx, ry, 0, STEEL[0], STEEL[1], STEEL[2], 0.85, 0);
      for (var n = 1; n < 9; n++) { var u = n / 9; pt(hx + (rx - hx) * u, hy + (ry - hy) * u, hz * (1 - u), WARM, 0.5, 2.0); }
    }
    /* cubo */
    for (i = 0; i < 420; i++) { a = rnd() * Math.PI * 2; pt(0.12 * Math.cos(a), 0.12 * Math.sin(a), (rnd() - 0.5) * 0.26, WARM, 0.95, 3.4); }
    for (i = 0; i < 90; i++) { a = i / 90 * Math.PI * 2; pt(0.045 * Math.cos(a), 0.045 * Math.sin(a), 0.16, ORANGE, 1, 3); pt(0.045 * Math.cos(a), 0.045 * Math.sin(a), -0.16, ORANGE, 1, 3); }
    var wheelCount = pts.length / 8, wheelLineCount = lns.length / 8;
    /* brasas ao redor (não giram junto com a roda) */
    var embers = [];
    for (i = 0; i < 160; i++) embers.push((rnd() - 0.5) * 3.2, (rnd() - 0.5) * 2.6, (rnd() - 0.5) * 1.6, ORANGE[0], ORANGE[1] * (0.7 + rnd() * 0.6), ORANGE[2], 0.25 + rnd() * 0.5, 1.4 + rnd() * 3);
    return {
      groups: [
        { points: pts.slice(0, wheelCount * 8), lines: lns, spin: true, tilt: 1 },
        { points: embers, drift: 0.06, tilt: 0.3 }
      ],
      rotX: -0.18, rotY: -0.5, mouseX: 0.4, mouseY: 0.3, spinSpeed: 0.32, scrollBoost: 0.6
    };
    });
})();