"""
Intelligent Traffic Signal Control Using Fuzzy Logic and Optimization
FOAI PBL - Mohammed Amaan Khan (25WU0101075)

Simulates a four-way intersection and compares:
  1. Fixed-time signal (30 s green per road)
  2. Best fixed-time signal (green time chosen by a sweep)
  3. Fuzzy controller with hand-set membership functions
  4. Fuzzy controller with membership functions tuned by a Genetic Algorithm

Run:  python traffic_fuzzy_ga.py
Output: results.json (used by make_charts.py)
"""
import json
import random
import time

import numpy as np

# ---------------------------------------------------------------- simulator
SIM_SECONDS = 3600        # one hour of traffic
DISCHARGE_GAP = 2         # one vehicle leaves every 2 s of green
LOST_TIME = 3             # yellow / all-red seconds on every phase change
MIN_GREEN = 6
MAX_GREEN = 60
SWITCH_BELOW = 4.0        # fuzzy extension under this many seconds means "switch"
UNIVERSE = 20             # queue lengths are clipped to 0..20, extension is 0..20 s

# arrival rate in vehicles per second for roads N, E, S, W
SCENARIOS = {
    "Light": [0.04, 0.04, 0.04, 0.04],
    "Heavy": [0.09, 0.09, 0.09, 0.09],
    "Unbalanced": [0.10, 0.03, 0.03, 0.03],
}
TRAIN_SEEDS = [1, 2, 3]
TEST_SEEDS = list(range(101, 111))


def make_arrivals(rates, seed):
    rng = np.random.default_rng(seed)
    return rng.poisson(rates, size=(SIM_SECONDS, 4)).tolist()


class FixedController:
    def __init__(self, green):
        self.green = green

    def first_green(self):
        return self.green

    def extend(self, q, phase, elapsed):
        return 0


class FuzzyController:
    def __init__(self, table):
        self.table = table

    def first_green(self):
        return MIN_GREEN

    def extend(self, q, phase, elapsed):
        if q[phase] == 0 or elapsed >= MAX_GREEN:
            return 0
        waiting = max(q[i] for i in range(4) if i != phase)
        e = self.table[min(q[phase], UNIVERSE)][min(waiting, UNIVERSE)]
        if e < SWITCH_BELOW:
            return 0
        return min(int(round(e)), MAX_GREEN - elapsed)


def simulate(controller, arrivals, trace_road=None):
    q = [0, 0, 0, 0]
    phase, lost, elapsed = 0, 0, 0
    remaining = controller.first_green()
    total_wait = arrived = departed = max_q = 0
    trace = []
    for t in range(SIM_SECONDS):
        a = arrivals[t]
        for i in range(4):
            q[i] += a[i]
            arrived += a[i]
        if lost > 0:
            lost -= 1
        else:
            if elapsed % DISCHARGE_GAP == 1 and q[phase] > 0:
                q[phase] -= 1
                departed += 1
            elapsed += 1
            remaining -= 1
            if remaining <= 0:
                ext = controller.extend(q, phase, elapsed)
                if ext <= 0:
                    phase = (phase + 1) % 4
                    lost, elapsed = LOST_TIME, 0
                    remaining = controller.first_green()
                else:
                    remaining = ext
        s = q[0] + q[1] + q[2] + q[3]
        total_wait += s
        m = max(q)
        if m > max_q:
            max_q = m
        if trace_road is not None:
            trace.append(q[trace_road])
    return {
        "avg_wait": total_wait / max(arrived, 1),   # seconds per vehicle
        "avg_queue": total_wait / SIM_SECONDS,      # vehicles waiting, all roads
        "max_queue": max_q,                         # longest single-road queue
        "throughput": departed,
        "trace": trace,
    }


# ------------------------------------------------------------- fuzzy engine
# Rule base: RULES[green queue][waiting queue] -> extension (0 Short, 1 Medium, 2 Long)
RULES = [[0, 0, 0],
         [1, 1, 0],
         [2, 1, 1]]

# Each variable is described by 5 numbers:
#   [short_end, medium_left, medium_peak, medium_right, long_start]
# Chromosome = green-queue (5) + waiting-queue (5) + extension (5) = 15 genes
HAND_TUNED = [8, 3, 10, 17, 12,
              8, 3, 10, 17, 12,
              8, 4, 10, 16, 12]


def memberships(p, x):
    s_end, m_l, m_p, m_r, l_start = p
    short = np.clip((s_end - x) / s_end, 0, 1)
    medium = np.clip(np.minimum((x - m_l) / (m_p - m_l), (m_r - x) / (m_r - m_p)), 0, 1)
    long_ = np.clip((x - l_start) / (UNIVERSE - l_start), 0, 1)
    return np.stack([short, medium, long_])


def build_table(genes):
    """Mamdani inference (AND = min, aggregation = max) with centroid
    defuzzification, precomputed for every integer pair of queue lengths."""
    xs = np.arange(UNIVERSE + 1, dtype=float)
    ys = np.linspace(0, UNIVERSE, 81)
    mu_g = memberships(genes[0:5], xs)
    mu_w = memberships(genes[5:10], xs)
    mu_o = memberships(genes[10:15], ys)
    n = UNIVERSE + 1
    fire = np.zeros((3, n, n))                     # firing strength per output set
    for i in range(3):
        for j in range(3):
            strength = np.minimum(mu_g[i][:, None], mu_w[j][None, :])
            k = RULES[i][j]
            fire[k] = np.maximum(fire[k], strength)
    agg = np.max(np.minimum(fire[:, :, :, None], mu_o[:, None, None, :]), axis=0)
    area = agg.sum(axis=2)
    centroid = np.where(area > 1e-9, (agg * ys).sum(axis=2) / np.maximum(area, 1e-9), 0.0)
    return centroid.tolist()


# -------------------------------------------------------- genetic algorithm
POP_SIZE = 30
GENERATIONS = 40
ELITES = 2
TOURNAMENT = 3
MUTATION_RATE = 0.2
MUTATION_SIGMA = 1.0


def repair(genes):
    """Keep every candidate a valid set of membership functions."""
    out = []
    for v in range(3):
        s_end, m_l, m_p, m_r, l_start = [min(max(g, 0.5), UNIVERSE - 0.5) for g in genes[v * 5:v * 5 + 5]]
        m_l, m_p, m_r = sorted([m_l, m_p, m_r])
        if m_p - m_l < 0.5:
            m_l = max(m_p - 0.5, 0.0)
        if m_r - m_p < 0.5:
            m_r = min(m_p + 0.5, float(UNIVERSE))
        out += [s_end, m_l, m_p, m_r, l_start]
    return out


def fitness(controller, arrival_sets):
    return sum(simulate(controller, a)["avg_wait"] for a in arrival_sets) / len(arrival_sets)


def run_ga(train_sets, seed=7):
    rnd = random.Random(seed)
    pop = [list(map(float, HAND_TUNED))]
    while len(pop) < POP_SIZE:
        pop.append(repair([g + rnd.gauss(0, 2.0) for g in HAND_TUNED]))
    history = []
    scored = []
    for gen in range(GENERATIONS + 1):
        scored = sorted(((fitness(FuzzyController(build_table(c)), train_sets), c) for c in pop),
                        key=lambda s: s[0])
        history.append({"gen": gen, "best": scored[0][0],
                        "mean": sum(s[0] for s in scored) / len(scored)})
        print(f"  generation {gen:2d}  best {scored[0][0]:.2f} s  mean {history[-1]['mean']:.2f} s")
        if gen == GENERATIONS:
            break
        nxt = [c for _, c in scored[:ELITES]]
        while len(nxt) < POP_SIZE:
            p1 = min(rnd.sample(scored, TOURNAMENT), key=lambda s: s[0])[1]
            p2 = min(rnd.sample(scored, TOURNAMENT), key=lambda s: s[0])[1]
            child = [a if rnd.random() < 0.5 else b for a, b in zip(p1, p2)]
            child = [g + rnd.gauss(0, MUTATION_SIGMA) if rnd.random() < MUTATION_RATE else g for g in child]
            nxt.append(repair(child))
        pop = nxt
    return scored[0][1], history


# --------------------------------------------------------------------- main
def main():
    t0 = time.time()
    train_sets = [make_arrivals(r, s) for r in SCENARIOS.values() for s in TRAIN_SEEDS]

    print("Sweeping fixed green times on training traffic...")
    sweep = {g: fitness(FixedController(g), train_sets) for g in range(5, 65, 5)}
    best_green = min(sweep, key=sweep.get)
    print("  best fixed green =", best_green, "s")

    print("Running Genetic Algorithm...")
    best_genes, history = run_ga(train_sets)

    controllers = {
        "Fixed 30 s": FixedController(30),
        f"Best fixed ({best_green} s)": FixedController(best_green),
        "Fuzzy": FuzzyController(build_table(HAND_TUNED)),
        "Fuzzy + GA": FuzzyController(build_table(best_genes)),
    }

    print("Testing on unseen traffic seeds...")
    results = {}
    for sc, rates in SCENARIOS.items():
        results[sc] = {}
        sets = [make_arrivals(rates, s) for s in TEST_SEEDS]
        for name, ctrl in controllers.items():
            runs = [simulate(ctrl, a) for a in sets]
            results[sc][name] = {
                k: float(np.mean([r[k] for r in runs])) for k in ("avg_wait", "avg_queue", "max_queue", "throughput")
            }
            results[sc][name]["wait_std"] = float(np.std([r["avg_wait"] for r in runs]))
            print(f"  {sc:11s} {name:20s} wait {results[sc][name]['avg_wait']:7.2f} s"
                  f"  max queue {results[sc][name]['max_queue']:5.1f}"
                  f"  throughput {results[sc][name]['throughput']:6.0f}")

    # queue on the busy road over time, one unseen run of the unbalanced scenario
    arr = make_arrivals(SCENARIOS["Unbalanced"], TEST_SEEDS[0])
    traces = {name: simulate(ctrl, arr, trace_road=0)["trace"] for name, ctrl in controllers.items()}

    with open("results.json", "w") as f:
        json.dump({
            "results": results, "history": history, "sweep": sweep, "best_green": best_green,
            "hand_tuned": HAND_TUNED, "ga_tuned": best_genes, "traces": traces,
            "controllers": list(controllers.keys()),
        }, f)
    print(f"Done in {time.time() - t0:.0f} s. Saved results.json")


if __name__ == "__main__":
    main()
