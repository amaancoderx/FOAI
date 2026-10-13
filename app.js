// User interface for the prototype: animation, live metrics, benchmark and plots.
(function () {
  const D = window.FOAI_DATA, S = window.Sim;
  const C = { ink: "#14181d", amber: "#e9a100", red: "#d2452f", green: "#2fc47a", muted: "#636a72", line: "#ddd7c9" };
  const CONTROLLERS = {
    "Fixed 30 s": () => S.fixedController(30),
    ["Best fixed (" + D.best_green + " s)"]: () => S.fixedController(D.best_green),
    "Fuzzy": () => S.fuzzyController(D.hand),
    "Fuzzy + GA": () => S.fuzzyController(D.ga),
  };
  const BAR_COLORS = ["#8f96a3", "#b0604f", "#2f6fb5", "#d98500"];
  const ROADS = ["North", "East", "South", "West"];
  const $ = (id) => document.getElementById(id);

  const state = { ctrl: "Fuzzy + GA", scen: "Unbalanced", seed: 101, playing: true, speed: 20, sim: null, hist: [], acc: 0 };

  function segment(el, names, key, onPick) {
    names.forEach((n) => {
      const b = document.createElement("button");
      b.textContent = n; b.type = "button";
      b.className = n === state[key] ? "on" : "";
      b.onclick = () => { state[key] = n; [...el.children].forEach((c) => c.classList.toggle("on", c === b)); onPick(); };
      el.appendChild(b);
    });
  }

  function restart() {
    state.sim = new S.Intersection(CONTROLLERS[state.ctrl](), S.SCENARIOS[state.scen], state.seed);
    state.hist = []; state.acc = 0;
    drawMF(); render();
  }

  // ---------------------------------------------------------------- road canvas
  const road = $("road"), g = road.getContext("2d");
  const W = 1120, MID = W / 2, HALF = 120, LANE = 60;

  function car(x, y, vertical, color) {
    const w = vertical ? 34 : 52, h = vertical ? 52 : 34;
    g.fillStyle = color;
    g.beginPath(); g.roundRect(x - w / 2, y - h / 2, w, h, 9); g.fill();
    g.fillStyle = "rgba(255,255,255,.35)";
    if (vertical) g.fillRect(x - 11, y - 12, 22, 9); else g.fillRect(x - 12, y - 11, 9, 22);
  }

  function lamp(x, y, colour) {
    g.fillStyle = "#232930"; g.beginPath(); g.roundRect(x - 26, y - 26, 52, 52, 12); g.fill();
    g.fillStyle = colour; g.beginPath(); g.arc(x, y, 16, 0, Math.PI * 2); g.fill();
  }

  function drawRoad() {
    const s = state.sim;
    g.fillStyle = "#e7e2d4"; g.fillRect(0, 0, W, W);
    g.fillStyle = "#3a4047";
    g.fillRect(MID - HALF, 0, HALF * 2, W); g.fillRect(0, MID - HALF, W, HALF * 2);
    g.strokeStyle = "#f6f3ec"; g.lineWidth = 4; g.setLineDash([22, 22]);
    g.beginPath();
    g.moveTo(MID, 0); g.lineTo(MID, MID - HALF); g.moveTo(MID, MID + HALF); g.lineTo(MID, W);
    g.moveTo(0, MID); g.lineTo(MID - HALF, MID); g.moveTo(MID + HALF, MID); g.lineTo(W, MID);
    g.stroke(); g.setLineDash([]);

    // stop lines
    g.lineWidth = 7; g.beginPath();
    g.moveTo(MID, MID - HALF); g.lineTo(MID + HALF, MID - HALF);
    g.moveTo(MID + HALF, MID); g.lineTo(MID + HALF, MID + HALF);
    g.moveTo(MID - HALF, MID + HALF); g.lineTo(MID, MID + HALF);
    g.moveTo(MID - HALF, MID - HALF); g.lineTo(MID - HALF, MID);
    g.stroke();

    // queues: vehicles keep to the left, as on Indian roads
    const step = 64, maxShown = 6;
    const lanes = [
      (k) => [MID + LANE, MID - HALF - 38 - k * step, true],
      (k) => [MID + HALF + 46 + k * step, MID + LANE, false],
      (k) => [MID - LANE, MID + HALF + 38 + k * step, true],
      (k) => [MID - HALF - 46 - k * step, MID - LANE, false],
    ];
    const labelAt = [[MID + HALF + 26, 66, "left"], [W - 24, MID + HALF + 62, "right"], [MID - HALF - 26, W - 40, "right"], [24, MID - HALF - 36, "left"]];
    const lampAt = [[MID + HALF + 44, MID - HALF - 44], [MID + HALF + 44, MID + HALF + 44], [MID - HALF - 44, MID + HALF + 44], [MID - HALF - 44, MID - HALF - 44]];
    for (let i = 0; i < 4; i++) {
      const n = s.q[i], busy = s.rates[i] === Math.max(...s.rates) && state.scen === "Unbalanced";
      for (let k = 0; k < Math.min(n, maxShown); k++) {
        const [x, y, v] = lanes[i](k);
        car(x, y, v, busy ? C.red : "#5b8fd6");
      }
      const isGreen = s.phase === i && s.lost === 0;
      const prev = (s.phase + 3) % 4;
      lamp(lampAt[i][0], lampAt[i][1], isGreen ? C.green : (s.lost > 0 && i === prev ? C.amber : C.red));
      g.fillStyle = C.ink; g.textAlign = labelAt[i][2];
      g.font = "600 30px 'Segoe UI', Arial"; g.fillText(ROADS[i] + ": " + n + " waiting", labelAt[i][0], labelAt[i][1]);
      g.font = "24px 'Segoe UI', Arial"; g.fillStyle = C.muted;
      g.fillText(Math.round(s.rates[i] * 3600) + " vehicles / hour", labelAt[i][0], labelAt[i][1] + 32);
    }
    if (s.justLeft >= 0) car(MID, MID, s.justLeft % 2 === 0, "#f6f3ec");

    g.textAlign = "center"; g.fillStyle = "#fff"; g.font = "600 26px 'Segoe UI', Arial";
    const txt = s.lost > 0 ? "changing" : ROADS[s.phase] + " green " + s.elapsed + " s";
    g.fillText(txt, MID, MID + HALF - 16);
  }

  // ------------------------------------------------------------------ live side
  function drawSpark() {
    const c = $("spark"), x = c.getContext("2d"), h = state.hist;
    x.clearRect(0, 0, c.width, c.height);
    const top = Math.max(20, ...h);
    x.strokeStyle = C.line; x.lineWidth = 2; x.beginPath(); x.moveTo(0, c.height - 2); x.lineTo(c.width, c.height - 2); x.stroke();
    if (h.length < 2) return;
    x.beginPath();
    h.forEach((v, i) => { const px = i / 599 * c.width, py = c.height - 6 - v / top * (c.height - 40); i ? x.lineTo(px, py) : x.moveTo(px, py); });
    x.strokeStyle = C.amber; x.lineWidth = 5; x.lineJoin = "round"; x.stroke();
    x.fillStyle = C.muted; x.font = "24px 'Segoe UI', Arial"; x.textAlign = "left"; x.fillText("peak " + top + " vehicles", 6, 26);
  }

  function decisionHTML() {
    const s = state.sim, c = s.c;
    if (c.kind === "fixed") {
      return "<div class='big'>Fixed timer</div>Every road gets <b>" + c.firstGreen() + " s</b> of green in turn. " +
        "It never looks at the queues, so an empty road holds green while a busy road keeps waiting.";
    }
    const d = c.last;
    if (!d) return "<div class='big'>Starting</div>Giving the minimum green of " + S.MIN_GREEN + " s, then the fuzzy rules decide.";
    const f = S.fire(c.genes, Math.min(d.g, 20), Math.min(d.w, 20));
    const names = ["Short", "Medium", "Long"], cols = [C.green, C.amber, C.red];
    let html = "<div class='big'>" + (d.why === "extend" ? "Extend green by " + Math.round(d.e) + " s" : "Switch to the next road") + "</div>";
    html += "Last decision: queue on green road <b>" + d.g + "</b>, longest waiting queue <b>" + d.w + "</b>";
    html += d.why === "extend" ? "." : " (" + d.why + ").";
    html += "<div style='margin-top:10px;'>Rule strength for each output set</div>";
    f.forEach((v, i) => {
      html += "<div style='font-size:13px;color:#636a72;'>Extension is " + names[i] + ": " + v.toFixed(2) + "</div>" +
        "<div class='bar'><i style='width:" + (v * 100) + "%;background:" + cols[i] + ";'></i></div>";
    });
    return html;
  }

  function render() {
    const s = state.sim;
    drawRoad();
    $("m-wait").textContent = s.avgWait.toFixed(1);
    $("m-queue").textContent = s.q[0] + s.q[1] + s.q[2] + s.q[3];
    $("m-max").textContent = s.maxQ;
    $("m-out").textContent = s.departed;
    const mm = String(Math.floor(s.t / 60)).padStart(2, "0"), ss = String(s.t % 60).padStart(2, "0");
    $("clock").textContent = "Simulated time " + mm + ":" + ss + " of 60:00" + (s.t >= S.SIM_SECONDS ? " (hour complete)" : "");
    $("decision").innerHTML = decisionHTML();
    drawSpark();
  }

  let lastFrame = performance.now();
  function frame(now) {
    const dt = Math.min(now - lastFrame, 100); lastFrame = now;
    const s = state.sim;
    if (state.playing && s.t < S.SIM_SECONDS) {
      state.acc += dt / 1000 * state.speed;
      let n = Math.floor(state.acc); state.acc -= n;
      while (n-- > 0 && s.t < S.SIM_SECONDS) {
        s.step();
        state.hist.push(s.q[0] + s.q[1] + s.q[2] + s.q[3]);
        if (state.hist.length > 600) state.hist.shift();
      }
      render();
    }
    requestAnimationFrame(frame);
  }

  // ------------------------------------------------------------------ benchmark
  function benchmark() {
    const names = Object.keys(CONTROLLERS), rates = S.SCENARIOS[state.scen], rows = [];
    names.forEach((n) => {
      const r = { n, wait: 0, queue: 0, max: 0, out: 0 };
      for (let seed = 101; seed <= 110; seed++) {
        const o = S.runHour(CONTROLLERS[n](), rates, seed);
        r.wait += o.avgWait / 10; r.queue += o.avgQueue / 10; r.max += o.maxQueue / 10; r.out += o.throughput / 10;
      }
      rows.push(r);
    });
    const c = $("benchc"), x = c.getContext("2d"), top = Math.max(...rows.map((r) => r.wait)) * 1.18;
    x.clearRect(0, 0, c.width, c.height);
    rows.forEach((r, i) => {
      const bw = 150, gap = (c.width - bw * 4) / 5, px = gap + i * (bw + gap), bh = r.wait / top * (c.height - 70);
      x.fillStyle = BAR_COLORS[i]; x.fillRect(px, c.height - 44 - bh, bw, bh);
      x.fillStyle = C.ink; x.textAlign = "center";
      x.font = "600 30px 'Segoe UI', Arial"; x.fillText(r.wait.toFixed(1) + " s", px + bw / 2, c.height - 54 - bh);
      x.font = "24px 'Segoe UI', Arial"; x.fillStyle = C.muted; x.fillText(r.n, px + bw / 2, c.height - 12);
    });
    const best = Math.min(...rows.map((r) => r.wait));
    $("bencht").innerHTML = "<tr><th>Controller</th><th>Wait (s)</th><th>Avg queue</th><th>Max queue</th><th>Cleared</th></tr>" +
      rows.map((r) => "<tr" + (r.wait === best ? " class='best'" : "") + "><td>" + r.n + "</td><td>" + r.wait.toFixed(1) + "</td><td>" +
        r.queue.toFixed(1) + "</td><td>" + r.max.toFixed(1) + "</td><td>" + Math.round(r.out) + "</td></tr>").join("");
  }

  // -------------------------------------------------------- membership functions
  function drawMF() {
    const c = $("mf"), x = c.getContext("2d");
    x.clearRect(0, 0, c.width, c.height);
    const titles = ["Queue on green road", "Queue on waiting roads", "Green extension (s)"];
    const active = state.ctrl === "Fuzzy + GA" ? D.ga : state.ctrl === "Fuzzy" ? D.hand : null;
    const pw = 300, ph = 380, y0 = 470;
    titles.forEach((t, v) => {
      const x0 = 30 + v * 330;
      x.strokeStyle = C.ink; x.lineWidth = 2; x.beginPath(); x.moveTo(x0, y0 - ph); x.lineTo(x0, y0); x.lineTo(x0 + pw, y0); x.stroke();
      const plot = (genes, colour, dash, width) => {
        const p = genes.slice(v * 5, v * 5 + 5);
        x.strokeStyle = colour; x.lineWidth = width; x.setLineDash(dash);
        for (let k = 0; k < 3; k++) {
          x.beginPath();
          for (let i = 0; i <= 100; i++) {
            const u = i / 5, m = S.memberships(p, u)[k];
            const px = x0 + u / 20 * pw, py = y0 - m * (ph - 20);
            i ? x.lineTo(px, py) : x.moveTo(px, py);
          }
          x.stroke();
        }
        x.setLineDash([]);
      };
      plot(D.hand, "#9aa1a9", [10, 8], 3);
      if (active && active !== D.hand) plot(active, "#d98500", [], 5);
      if (active === D.hand) plot(D.hand, "#2f6fb5", [], 5);
      x.fillStyle = C.ink; x.font = "600 26px 'Segoe UI', Arial"; x.textAlign = "left"; x.fillText(t, x0, y0 - ph - 16);
      x.fillStyle = C.muted; x.font = "22px 'Segoe UI', Arial"; x.textAlign = "center";
      [0, 10, 20].forEach((n) => x.fillText(n, x0 + n / 20 * pw, y0 + 30));
    });
  }

  // ----------------------------------------------------------------------- wire
  segment($("ctrl"), Object.keys(CONTROLLERS), "ctrl", restart);
  segment($("scen"), Object.keys(S.SCENARIOS), "scen", () => { restart(); benchmark(); });
  $("speed").oninput = (e) => { state.speed = +e.target.value; $("speedv").textContent = state.speed; };
  $("play").onclick = () => { state.playing = !state.playing; $("play").textContent = state.playing ? "Pause" : "Play"; };
  $("restart").onclick = restart;
  $("newseed").onclick = () => { state.seed = 1 + Math.floor(Math.random() * 100000); restart(); };
  $("bench").onclick = benchmark;

  const preset = new URLSearchParams(location.search).get("t");
  restart();
  if (preset) { for (let i = 0; i < +preset; i++) { state.sim.step(); state.hist.push(state.sim.q.reduce((a, b) => a + b, 0)); if (state.hist.length > 600) state.hist.shift(); } state.playing = false; $("play").textContent = "Play"; render(); }
  benchmark();
  requestAnimationFrame(frame);
})();
