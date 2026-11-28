"""Pool the original per-frame samples and summarize observed V8 dispatch."""
import json
import math
import sys
from pathlib import Path


browser, native = map(Path, sys.argv[1:])
cases = ["animometer-setup", *[f"animometer-uniforms-{k}" for k in (0, 1, 3, 6)], "animometer"]


def read(folder, name):
    return json.loads((folder / name).read_text())


def summarize(series):
    samples = sorted(series)
    return [samples[math.ceil(len(samples) * q) - 1] for q in (0.50, 0.95)]


table = {}
for case in cases:
    paths = [(browser, key) for key in ("native", "js", "rust")]
    backends = ["calibration", "rust", "angle"]
    if case == "animometer":
        backends.extend(name + "-fallback" for name in backends.copy())
    paths.extend((native, key) for key in backends)
    records = {}
    for folder, key in paths:
        samples, rounds, counts = [], [], [0] * 4
        for r in (1, 2, 3):
            d = read(folder, f"{r}-{case}-{key}.json")
            assert (d["name"], d["warmup"], d["samples"]) == (case, 30, 120)
            if folder == native:
                frame_times = d["times"]
                counts = [a + b for a, b in zip(counts, d["counts"])]
                if key == "calibration-fallback":
                    assert d["checksum"] == read(native, f"{r}-{case}-calibration.json")["checksum"]
            else:
                assert d["status"] == "pass" and not d["errors"]
                frame_times = d["measurement"]["cpu"]
            assert len(frame_times) == 120 and all(math.isfinite(t) and t >= 0 for t in frame_times)
            samples.extend(frame_times)
            rounds.append(summarize(frame_times))
        record = {"pooled": summarize(samples), "rounds": rounds}
        if folder == native:
            record["counts"] = counts
        records[("node-" if folder == native else "chrome-") + key] = record
    if case == "animometer":
        for backend in ("calibration", "rust", "angle"):
            fast = records["node-" + backend]["counts"]
            slow = records["node-" + backend + "-fallback"]["counts"]
            assert fast[0] and fast[2] and slow == [0, 7200000, 0, 43200000]
    table[case] = records

images = read(native, "images.json")
assert len(images) == 42
assert all(img["overTwo"] <= 960 for img in images)
(native / "summary.json").write_text(json.dumps(table, indent=2) + "\n")
for case, records in table.items():
    print(case, " | ".join(f"{a:.3f} / {b:.3f}" for a, b in (r["pooled"] for r in records.values())))
