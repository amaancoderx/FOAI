"""Draws the Review 2 charts from results.json into the charts/ folder."""
import json
import os

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np

plt.rcParams.update({
    "font.family": "Segoe UI", "font.size": 12, "svg.fonttype": "none",
    "axes.spines.top": False, "axes.spines.right": False,
    "axes.edgecolor": "#8b9198", "axes.labelcolor": "#3a4148",
    "xtick.color": "#3a4148", "ytick.color": "#3a4148",
    "axes.grid": True, "grid.color": "#e6e1d5", "grid.linewidth": 0.8, "axes.axisbelow": True,
})
INK = "#14181d"
COLORS = ["#8f96a3", "#b0604f", "#2f6fb5", "#d98500"]   # fixed, best fixed, fuzzy, fuzzy + GA
U = 20

d = json.load(open("results.json"))
names = d["controllers"]
os.makedirs("charts", exist_ok=True)

# 1. average waiting time, one panel per scenario
fig, axes = plt.subplots(1, 3, figsize=(11.6, 3.7))
for ax, (sc, res) in zip(axes, d["results"].items()):
    vals = [res[n]["avg_wait"] for n in names]
    bars = ax.bar(range(4), vals, color=COLORS, width=0.72)
    for b, v in zip(bars, vals):
        ax.text(b.get_x() + b.get_width() / 2, v + max(vals) * 0.02, f"{v:.1f}",
                ha="center", va="bottom", color=INK, fontsize=12.5, fontweight="bold")
    ax.set_title(sc + " traffic", loc="left", color=INK, fontsize=14, fontweight="bold")
    ax.set_xticks([])
    ax.set_ylim(0, 66)
    ax.grid(axis="x", visible=False)
axes[0].set_ylabel("Average wait per vehicle (s)")
fig.legend(axes[0].patches, names, loc="lower center", ncol=4, frameon=False, fontsize=12.5)
fig.tight_layout(rect=(0, 0.09, 1, 1))
fig.savefig("charts/wait.svg", transparent=True)

# 2. GA convergence
h = d["history"]
fig, ax = plt.subplots(figsize=(5.7, 3.5))
g = [x["gen"] for x in h]
import traffic_fuzzy_ga as tf
train = [tf.make_arrivals(r, s) for r in tf.SCENARIOS.values() for s in tf.TRAIN_SEEDS]
hand_fit = tf.fitness(tf.FuzzyController(tf.build_table(tf.HAND_TUNED)), train)
ax.axhline(hand_fit, color="#2f6fb5", lw=2, ls=(0, (4, 3)), label="Hand-set fuzzy")
ax.plot(g, [x["mean"] for x in h], color="#8f96a3", lw=2, label="Population mean")
ax.plot(g, [x["best"] for x in h], color="#d98500", lw=2.5, label="Best candidate")
ax.text(g[-1], hand_fit + 0.3, f"{hand_fit:.1f} s", ha="right", color=INK, fontweight="bold")
ax.text(g[-1], h[-1]["best"] - 1.1, f"{h[-1]['best']:.1f} s", ha="right", color=INK, fontweight="bold")
ax.set_xlabel("Generation")
ax.set_ylabel("Fitness: average wait (s)")
ax.set_ylim(h[-1]["best"] - 3, hand_fit + 2)
ax.legend(frameon=False, loc="center right", fontsize=11)
print("hand-set train fitness", round(hand_fit, 2))
fig.tight_layout()
fig.savefig("charts/ga.svg", transparent=True)

# 3. membership functions before and after GA
def mfs(p, x):
    s, ml, mp, mr, ls = p
    return [np.clip((s - x) / s, 0, 1),
            np.clip(np.minimum((x - ml) / (mp - ml), (mr - x) / (mr - mp)), 0, 1),
            np.clip((x - ls) / (U - ls), 0, 1)]

x = np.linspace(0, U, 401)
titles = ["Queue on green road (vehicles)", "Queue on waiting roads (vehicles)", "Green extension (seconds)"]
fig, axes = plt.subplots(1, 3, figsize=(11.6, 2.9))
for v, ax in enumerate(axes):
    for m in mfs(d["hand_tuned"][v * 5:v * 5 + 5], x):
        l1, = ax.plot(x, m, color="#8b9198", lw=1.8, ls=(0, (4, 3)))
    for m in mfs(d["ga_tuned"][v * 5:v * 5 + 5], x):
        l2, = ax.plot(x, m, color="#d98500", lw=2.5)
    ax.set_xlabel(titles[v])
    ax.set_xlim(0, U)
    ax.set_ylim(0, 1.08)
    ax.set_yticks([0, 0.5, 1])
    ax.grid(False)
axes[0].set_ylabel("Membership")
fig.legend([l1, l2], ["Hand-set (before)", "GA-tuned (after)"], loc="upper center", ncol=2, frameon=False, fontsize=12.5)
fig.tight_layout(rect=(0, 0, 1, 0.9))
fig.savefig("charts/mf.svg", transparent=True)

# 4. queue on the busy road over one hour, unbalanced scenario
fig, ax = plt.subplots(figsize=(6.3, 3.5))
t = np.arange(3600) / 60
for n, c, lw in [(names[0], "#8f96a3", 1.6), (names[2], "#2f6fb5", 1.6), (names[3], "#d98500", 1.8)]:
    ax.plot(t, d["traces"][n], color=c, lw=lw, label=n)
ax.set_xlabel("Time (minutes)")
ax.set_ylabel("Vehicles queued on busy road")
ax.set_xlim(0, 60)
ax.set_ylim(bottom=0)
ax.legend(frameon=False, loc="upper center", ncol=3, bbox_to_anchor=(0.5, 1.17), fontsize=11.5)
fig.tight_layout()
fig.savefig("charts/trace.svg", transparent=True)

print("GA start", round(h[0]["best"], 2), "end", round(h[-1]["best"], 2))
print("sweep", {k: round(v, 1) for k, v in d["sweep"].items()})
print("ga genes", [round(v, 1) for v in d["ga_tuned"]])
for sc, res in d["results"].items():
    for n in names:
        r = res[n]
        print(sc, n, "| queue", round(r["avg_queue"], 1), "| std", round(r["wait_std"], 2))
