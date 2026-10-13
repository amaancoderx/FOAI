// Intersection simulator and fuzzy engine.
// JavaScript port of traffic_fuzzy_ga.py so the same model can run in the browser.
(function (root) {
  const SIM_SECONDS = 3600;
  const DISCHARGE_GAP = 2;   // one vehicle leaves every 2 s of green
  const LOST_TIME = 3;       // yellow / all-red seconds on every phase change
  const MIN_GREEN = 6;
  const MAX_GREEN = 60;
  const SWITCH_BELOW = 4.0;  // extension under this many seconds means "switch"
  const UNIVERSE = 20;

  // arrival rate in vehicles per second for roads N, E, S, W
  const SCENARIOS = {
    Light: [0.04, 0.04, 0.04, 0.04],
    Heavy: [0.09, 0.09, 0.09, 0.09],
    Unbalanced: [0.10, 0.03, 0.03, 0.03],
  };

  // RULES[green queue][waiting queue] -> extension (0 Short, 1 Medium, 2 Long)
  const RULES = [[0, 0, 0], [1, 1, 0], [2, 1, 1]];
  const HAND_TUNED = [8, 3, 10, 17, 12, 8, 3, 10, 17, 12, 8, 4, 10, 16, 12];

  const clip01 = (v) => Math.max(0, Math.min(1, v));

  // p = [short_end, medium_left, medium_peak, medium_right, long_start]
  function memberships(p, x) {
    return [
      clip01((p[0] - x) / p[0]),
      clip01(Math.min((x - p[1]) / (p[2] - p[1]), (p[3] - x) / (p[3] - p[2]))),
      clip01((x - p[4]) / (UNIVERSE - p[4])),
    ];
  }

  // Firing strength of each output set for one pair of inputs (AND = min, OR = max)
  function fire(genes, g, w) {
    const mg = memberships(genes.slice(0, 5), g);
    const mw = memberships(genes.slice(5, 10), w);
    const f = [0, 0, 0];
    for (let i = 0; i < 3; i++)
      for (let j = 0; j < 3; j++) f[RULES[i][j]] = Math.max(f[RULES[i][j]], Math.min(mg[i], mw[j]));
    return f;
  }

  // Mamdani inference with centroid defuzzification for every integer queue pair
  function buildTable(genes) {
    const out = genes.slice(10, 15);
    const ys = [], mo = [];
    for (let k = 0; k <= 80; k++) { ys.push(k * UNIVERSE / 80); mo.push(memberships(out, ys[k])); }
    const table = [];
    for (let g = 0; g <= UNIVERSE; g++) {
      table.push([]);
      for (let w = 0; w <= UNIVERSE; w++) {
        const f = fire(genes, g, w);
        let area = 0, moment = 0;
        for (let k = 0; k <= 80; k++) {
          const a = Math.max(Math.min(f[0], mo[k][0]), Math.min(f[1], mo[k][1]), Math.min(f[2], mo[k][2]));
          area += a; moment += a * ys[k];
        }
        table[g].push(area > 1e-9 ? moment / area : 0);
      }
    }
    return table;
  }

  function fixedController(green) {
    return { kind: "fixed", firstGreen: () => green, extend: () => 0 };
  }

  function fuzzyController(genes) {
    const table = buildTable(genes);
    const c = {
      kind: "fuzzy", genes, table, last: null,
      firstGreen: () => MIN_GREEN,
      extend(q, phase, elapsed) {
        if (q[phase] === 0 || elapsed >= MAX_GREEN) {
          c.last = { g: q[phase], w: 0, e: 0, why: q[phase] === 0 ? "road empty" : "max green reached" };
          return 0;
        }
        let waiting = 0;
        for (let i = 0; i < 4; i++) if (i !== phase && q[i] > waiting) waiting = q[i];
        const e = table[Math.min(q[phase], UNIVERSE)][Math.min(waiting, UNIVERSE)];
        c.last = { g: q[phase], w: waiting, e, why: e < SWITCH_BELOW ? "extension too small" : "extend" };
        if (e < SWITCH_BELOW) return 0;
        return Math.min(Math.round(e), MAX_GREEN - elapsed);
      },
    };
    return c;
  }

  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function poisson(lambda, rnd) {
    const limit = Math.exp(-lambda);
    let k = 0, p = rnd();
    while (p > limit) { k++; p *= rnd(); }
    return k;
  }

  // One intersection, advanced one second at a time
  class Intersection {
    constructor(controller, rates, seed) {
      this.c = controller; this.rates = rates; this.rnd = mulberry32(seed);
      this.q = [0, 0, 0, 0];
      this.phase = 0; this.lost = 0; this.elapsed = 0;
      this.remaining = controller.firstGreen();
      this.t = 0; this.totalWait = 0; this.arrived = 0; this.departed = 0; this.maxQ = 0;
      this.switches = 0; this.justLeft = -1;
    }
    step() {
      const q = this.q;
      this.justLeft = -1;
      for (let i = 0; i < 4; i++) { const a = poisson(this.rates[i], this.rnd); q[i] += a; this.arrived += a; }
      if (this.lost > 0) {
        this.lost--;
      } else {
        if (this.elapsed % DISCHARGE_GAP === 1 && q[this.phase] > 0) {
          q[this.phase]--; this.departed++; this.justLeft = this.phase;
        }
        this.elapsed++; this.remaining--;
        if (this.remaining <= 0) {
          const ext = this.c.extend(q, this.phase, this.elapsed);
          if (ext <= 0) {
            this.phase = (this.phase + 1) % 4;
            this.lost = LOST_TIME; this.elapsed = 0; this.switches++;
            this.remaining = this.c.firstGreen();
          } else {
            this.remaining = ext;
          }
        }
      }
      this.totalWait += q[0] + q[1] + q[2] + q[3];
      this.maxQ = Math.max(this.maxQ, q[0], q[1], q[2], q[3]);
      this.t++;
    }
    get avgWait() { return this.totalWait / Math.max(this.arrived, 1); }
    get avgQueue() { return this.totalWait / Math.max(this.t, 1); }
  }

  function runHour(controller, rates, seed) {
    const s = new Intersection(controller, rates, seed);
    for (let t = 0; t < SIM_SECONDS; t++) s.step();
    return { avgWait: s.avgWait, avgQueue: s.avgQueue, maxQueue: s.maxQ, throughput: s.departed };
  }

  const api = {
    SIM_SECONDS, LOST_TIME, MIN_GREEN, MAX_GREEN, SWITCH_BELOW, UNIVERSE, SCENARIOS, RULES, HAND_TUNED,
    memberships, fire, buildTable, fixedController, fuzzyController, Intersection, runHour,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.Sim = api;
})(this);
