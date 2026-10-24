#!/usr/bin/env python3
"""Build assets/data/results.json for the project page from the released results.

Every number on the page comes from this file, and this file comes only from
compute-floor/Results. Re-run after any change there:

    python scripts/build_data.py --results ../compute-floor/Results
"""
import argparse
import json
from pathlib import Path

import numpy as np
import pandas as pd

TIERS = ["SUPER_LIGHT", "LIGHT", "HEAVY"]
SCENARIO = "S2_9R_9S"
METHODS = ["Group-DRO", "DoReMi-style", "Aioli", "DoGE", "Skill-It", "Stratified"]
FAMILY = {
    "Group-DRO": "loss",
    "DoReMi-style": "loss",
    "Aioli": "interaction",
    "DoGE": "interaction",
    "Skill-It": "hybrid",
    "Stratified": "control",
}
MODEL = {"SUPER_LIGHT": "pythia-70m", "LIGHT": "pythia-70m", "HEAVY": "pythia-160m"}


def r(x, n=4):
    return None if x is None or (isinstance(x, float) and np.isnan(x)) else round(float(x), n)


def tier_block(main: Path, tier: str) -> dict:
    tag = f"{tier}_{SCENARIO}"
    share = pd.read_csv(main / f"agg_{tag}_synth_share.csv")
    test = pd.read_csv(main / f"agg_{tag}_test_loss.csv")
    test = test[test["eval"] == "test_loss"].set_index("method")
    traj = pd.read_csv(main / f"agg_{tag}_weight_trajectories.csv")
    flops = pd.read_csv(main / f"flops_{tier}.csv")
    res = np.load(main / f"results_{tag}.npy", allow_pickle=True).item()

    # Methods log different numbers of rounds (Aioli probes, Stratified never moves),
    # so "final" is each method's own last logged round.
    last = traj.groupby("method")["round"].transform("max")
    seed_share = (
        traj[(traj["round"] == last) & traj["is_synth"]]
        .groupby(["method", "seed"])["weight"].sum()
    )

    seed_test = {}
    for entry in res["per_seed"]:
        for m, v in entry["test_loss"].items():
            vals = list(v.values()) if isinstance(v, dict) else list(np.ravel(v))
            seed_test.setdefault(m, []).append(r(np.nanmean(vals)))

    methods = {}
    for m in METHODS:
        s = share[share["method"] == m].sort_values("round")
        fin = s.iloc[-1]
        methods[m] = {
            "family": FAMILY[m],
            "rounds": [
                {
                    "round": int(row["round"]),
                    "share": r(row["synth_share_mean"]),
                    "share_sd": r(row["synth_share_std"]),
                    "l2": r(row["l2_mean"]),
                    "l2_sd": r(row["l2_std"]),
                }
                for _, row in s.iterrows()
            ],
            "final_share": r(fin["synth_share_mean"]),
            "final_share_sd": r(fin["synth_share_std"]),
            "final_l2": r(fin["l2_mean"]),
            "seed_share": [r(v) for v in seed_share.loc[m].sort_index().tolist()],
            "test": r(test.loc[m, "test_loss_mean"], 3),
            "test_sd": r(test.loc[m, "test_loss_std"], 3),
            "test_real": r(test.loc[m, "real_mean"], 3),
            "test_synth": r(test.loc[m, "synth_mean"], 3),
            "seed_test": seed_test.get(m, []),
        }

    base = flops[flops["method"].str.startswith("base")].iloc[0]
    cfg = res["cfg"]
    return {
        "model": MODEL[tier],
        "params": int(base["params"]),
        "tokens": float(base["tokens"]),
        "flops": float(base["flops"]),
        "flops_doge": float(flops[flops["method"].str.startswith("DoGE")]["flops"].iloc[0]),
        "flops_skillit": float(flops[flops["method"].str.startswith("Skill-It")]["flops"].iloc[0]),
        "ctx": int(cfg["context_length"]),
        "batch": int(cfg["batch_size"]),
        "max_steps": int(cfg["max_steps"]),
        "methods": methods,
    }


def heavy_detail(main: Path) -> dict:
    tag = f"HEAVY_{SCENARIO}"
    w = pd.read_csv(main / f"agg_{tag}_final_weights.csv")
    domains = w[w["method"] == "Aioli"][["domain", "is_synth"]].to_dict("records")
    weights = {
        m: {row["domain"]: [r(row["weight_mean"]), r(row["weight_std"])] for _, row in w[w["method"] == m].iterrows()}
        for m in METHODS
    }

    v = pd.read_csv(main / f"agg_{tag}_val_loss_trajectories.csv")
    v = v[v["method"] == "Aioli"]
    per_domain = v.groupby(["round", "pretty", "is_synth"])["val_loss"].mean().reset_index()
    val_rounds = []
    for rnd, g in per_domain.groupby("round"):
        row = {"round": int(rnd)}
        for key, synth in (("real", False), ("synth", True)):
            vals = g[g["is_synth"] == synth]["val_loss"]
            row[key] = r(vals.mean(), 3)
            row[key + "_lo"] = r(vals.min(), 3)
            row[key + "_hi"] = r(vals.max(), 3)
        val_rounds.append(row)
    final_round = per_domain["round"].max()
    val_final = {
        row["pretty"]: r(row["val_loss"], 3)
        for _, row in per_domain[per_domain["round"] == final_round].iterrows()
    }
    return {
        "domains": [{"name": d["domain"], "synth": bool(d["is_synth"])} for d in domains],
        "weights": weights,
        "val_loss": val_rounds,
        "val_final": val_final,
    }


def main() -> None:
    here = Path(__file__).resolve().parents[1]
    ap = argparse.ArgumentParser()
    ap.add_argument("--results", type=Path, default=here.parent / "compute-floor" / "Results")
    ap.add_argument("--out", type=Path, default=here / "assets" / "data" / "results.json")
    args = ap.parse_args()

    main_dir = args.results / "main"
    payload = {
        "scenario": SCENARIO,
        "methods": METHODS,
        "family": FAMILY,
        "tiers": {t: tier_block(main_dir, t) for t in TIERS},
        "heavy": heavy_detail(main_dir),
    }
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(payload, separators=(",", ":")), encoding="utf-8")
    print(f"wrote {args.out} ({args.out.stat().st_size / 1024:.1f} KB)")


if __name__ == "__main__":
    main()
