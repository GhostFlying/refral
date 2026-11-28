"""Run the frozen browser suite once, under the shared Mini GPU lock."""
import fcntl
import json
import os
from datetime import datetime, timezone
from pathlib import Path
import subprocess

root = Path(__file__).resolve().parents[1]
os.chdir(root)
suite = json.loads(Path('benchmarks/browser-baseline-v1.json').read_text())
lock_path = Path('artifacts/conformance/campaign/gpu.lock')
lock_path.parent.mkdir(parents=True, exist_ok=True)
with lock_path.open('a+') as lock:
    fcntl.flock(lock, fcntl.LOCK_EX)
    inputs = ['packages', 'crates', 'examples', 'benchmarks', 'tools/external-benchmarks.mjs',
              'tests/performance', 'pnpm-lock.yaml', 'Cargo.lock', 'fixtures.lock.json']
    if subprocess.check_output(['git', 'status', '--porcelain', '--', *inputs]):
        raise SystemExit('Commit benchmark and rendering inputs before collecting a baseline.')
    output = Path('artifacts/browser-baseline-v1') / datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S.%fZ')
    output.mkdir(parents=True, exist_ok=False)
    print(output, flush=True)
    env = dict(os.environ, REFRAL_TEST='1', REFRAL_BENCHMARK='1', REFRAL_HEADLESS='1',
               REFRAL_CASES=','.join(suite['externalDraws']), REFRAL_BACKENDS=','.join(suite['routes']),
               REFRAL_HEAVY_SCENES=','.join(suite['three']), REFRAL_EXTERNAL_OUTPUT=str(output / 'external'),
               REFRAL_HEAVY_OUTPUT=str(output / 'three'))
    for setting in ('rounds', 'warmup', 'samples'):
        for prefix in ('REFRAL_', 'REFRAL_HEAVY_'):
            env[prefix + setting.upper()] = str(suite[setting])
    for command in (['node', '--use-env-proxy', 'tools/deps-three-scenes.mjs'],
                    ['node', 'tools/external-benchmarks.mjs'], ['pnpm', 'bench:three:heavy'],
                    ['node', 'tools/browser-baseline-report.mjs', str(output)]):
        subprocess.run(command, env=env, check=True)
