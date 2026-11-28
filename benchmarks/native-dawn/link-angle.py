"""Expose the pinned Chromium build's static ANGLE dispatcher without rebuilding Chromium."""
import pathlib
import shlex
import subprocess
import sys

out, dest = (pathlib.Path(x).resolve() for x in sys.argv[1:])
lines = (out / "obj/ui/gl/init/init.ninja").read_text().splitlines()
rule = next(line for line in lines if line.startswith("build ") and ": solink " in line)
inputs = rule.split(": solink ", 1)[1].split(" || ", 1)[0].split()
libs = [word.removesuffix(".TOC") for word in inputs if word.endswith((".o", ".a", ".dylib.TOC"))]
flags = []
for line in lines:
    if line.strip().startswith(("libs =", "frameworks =")):
        flags.extend(shlex.split(line.split("=", 1)[1]))
wrapper = pathlib.Path(__file__).with_name("angle-procs.cc").resolve()
subprocess.run(
    [
        "clang++", "-dynamiclib", "-std=c++20", str(wrapper), *libs, *flags,
        "-Wl,-rpath," + str(out), "-Wl,-install_name,@rpath/libprobe_angle.dylib",
        "-Wl,-exported_symbol,_rfAngleProc", "-o", str(dest),
    ],
    cwd=out, check=True,
)
