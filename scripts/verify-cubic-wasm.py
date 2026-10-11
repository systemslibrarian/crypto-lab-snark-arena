"""Rebuild immutable circuit inputs twice and compare with the shipped Git blob."""
import argparse
import datetime
import hashlib
import json
import os
import pathlib
import platform
import re
import shutil
import subprocess
import tarfile
import tempfile
import time
import tomllib
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parents[1]
CIRCOM_COMMIT = 'ad44e915a12bb047b05745c2884aad9cc8326bc6'
ARCHIVE_SHA256 = 'a0dbdd151cee500dfea459c4ce7f4417ff06ae7ac81502e1db35a6843749d827'
LOCK_SHA256 = 'eee7a607818fd0084d319f3098ed2babae00976bc23f6f48ace36377215b620d'
RUST_COMMIT = '17067e9ac6d7ecb70e50f92c1944e545188d2359'
CIRCUIT = 'public/zk/cubic.circom'
SHIPPED = 'public/zk/cubic.wasm'


def digest(data):
    return hashlib.sha256(data).hexdigest()


def run_command(command, cwd, env, report, save, timeout=600):
    row = dict(command=command, startedAt=datetime.datetime.now(datetime.timezone.utc).isoformat())
    started = time.monotonic()
    try:
        result = subprocess.run(command, cwd=cwd, env=env, capture_output=True, text=True, timeout=timeout)
        row.update(exit=result.returncode, stdout=result.stdout, stderr=result.stderr)
    except subprocess.TimeoutExpired as error:
        def text(value):
            return value.decode(errors='replace') if isinstance(value, bytes) else value or ''
        row.update(exit=None, timedOut=True, stdout=text(error.stdout), stderr=text(error.stderr))
        raise RuntimeError('Command timed out: ' + ' '.join(command)) from error
    except OSError as error:
        row.update(exit=None, unavailable=True, error=str(error))
        raise RuntimeError('Command unavailable: ' + ' '.join(command)) from error
    finally:
        row.update(finishedAt=datetime.datetime.now(datetime.timezone.utc).isoformat(), seconds=time.monotonic()-started)
        report['commands'].append(row)
        save()
    if result.returncode:
        raise RuntimeError('Command failed: ' + ' '.join(command))
    return result.stdout.strip()


def validate_compiler(identity):
    fields = {}
    for line in identity.splitlines()[1:]:
        if ': ' not in line:
            raise RuntimeError('Malformed actual compiler identity')
        key, value = line.split(': ', 1)
        if key in fields:
            raise RuntimeError('Ambiguous actual compiler identity')
        fields[key] = value
    if not identity.startswith('rustc 1.87.0 (17067e9ac ') or fields.get('release') != '1.87.0' or fields.get('commit-hash') != RUST_COMMIT or not fields.get('host') or not fields.get('LLVM version'):
        raise RuntimeError('Unexpected actual Rust compiler')


def unpack_verified(archive, expected, destination):
    if digest(archive.read_bytes()) != expected:
        raise RuntimeError('Compiler source archive hash mismatch; refusing execution')
    with tarfile.open(archive) as bundle:
        for item in bundle.getmembers():
            path = pathlib.PurePosixPath(item.name)
            if path.is_absolute() or '..' in path.parts or not (item.isdir() or item.isfile()):
                raise RuntimeError('Unsafe compiler archive member')
        bundle.extractall(destination, filter='data')


def registry_packages(lockfile):
    if digest(lockfile.read_bytes()) != LOCK_SHA256:
        raise RuntimeError('Compiler dependency lock hash mismatch')
    packages = tomllib.loads(lockfile.read_text()).get('package')
    if not isinstance(packages, list) or not packages:
        raise RuntimeError('Incomplete compiler dependency lock')
    rows = []
    for package in packages:
        if package.get('source') is None:
            continue
        checksum = package.get('checksum', '')
        if package['source'] != 'registry+https://github.com/rust-lang/crates.io-index' or not re.fullmatch('[0-9a-f]{64}', checksum):
            raise RuntimeError('Unsupported or incomplete compiler dependency provenance')
        rows.append(dict(name=package['name'], version=package['version'], checksum=checksum))
    if not rows:
        raise RuntimeError('Missing compiler registry dependency coverage')
    return rows


def verify_registry_archives(packages, cargo_home):
    for package in packages:
        filename = package['name'] + '-' + package['version'] + '.crate'
        matches = list((cargo_home / 'registry/cache').glob('*/' + filename))
        if len(matches) != 1 or digest(matches[0].read_bytes()) != package['checksum']:
            raise RuntimeError('Missing or changed locked dependency archive: ' + filename)


def capture_source(root, destination):
    def git(*args):
        return subprocess.check_output(['git', '-C', str(root), *args], stderr=subprocess.PIPE)
    sha = git('rev-parse', 'HEAD').decode().strip()
    if not re.fullmatch('[0-9a-f]{40}', sha):
        raise RuntimeError('Invalid source SHA')
    if git('status', '--porcelain', '--untracked-files=all', '--', 'public/zk'):
        raise RuntimeError('Uncommitted circuit inputs; commit reviewed inputs before reproduction')
    rows = []
    for entry in git('ls-tree', '-r', '-z', sha, '--', 'public/zk').split(b'\0'):
        if not entry:
            continue
        header, name = entry.split(b'\t', 1)
        mode, kind, blob = header.decode().split()
        name = name.decode()
        if kind != 'blob' or mode not in ('100644', '100755'):
            raise RuntimeError('Unsupported tracked circuit object: ' + name)
        path = pathlib.PurePosixPath(name)
        if path.is_absolute() or '..' in path.parts:
            raise RuntimeError('Unsafe tracked source path')
        data = git('cat-file', 'blob', blob)
        target = destination / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)
        rows.append(dict(path=name, gitBlob=blob, bytes=len(data), sha256=digest(data)))
    paths = {row['path'] for row in rows}
    if not {CIRCUIT, SHIPPED} <= paths:
        raise RuntimeError('Incomplete tracked circuit inputs')
    # This recipe covers exactly the current self-contained circuit, not hidden includes.
    if {name for name in paths if name.endswith('.circom')} != {CIRCUIT} or re.search(r'\binclude\s', (destination / CIRCUIT).read_text()):
        raise RuntimeError('Unsupported additional circuit inputs; extend coverage before verification')
    return sha, rows


def compare_artifacts(first, second, shipped):
    rows = []
    for name, header in [('cubic_js/cubic.wasm', b'\0asm\x01\0\0\0'), ('cubic.r1cs', b'r1cs\x01\0\0\0')]:
        a, b = (first / name).read_bytes(), (second / name).read_bytes()
        if len(a) <= 8 or len(b) <= 8:
            raise RuntimeError('Empty or incomplete compiler artifact: ' + name)
        if a[:8] != header or b[:8] != header:
            raise RuntimeError('Malformed compiler artifact: ' + name)
        if a != b:
            raise RuntimeError('Independent clean circuit builds differ: ' + name)
        row = dict(path=name, bytes=len(a), sha256=digest(a), repeatMatches=True)
        if name.endswith('.wasm'):
            expected = shipped.read_bytes()
            row.update(shippedSha256=digest(expected), matchesShipped=a == expected)
            if not row['matchesShipped']:
                raise RuntimeError('Rebuilt WASM differs from captured shipped Git blob')
        else:
            row['historicalR1csComparison'] = 'not-available'
        rows.append(row)
    return rows


def verify_unchanged(root, source_sha, recipe, recipe_hash):
    current = subprocess.check_output(['git', '-C', str(root), 'rev-parse', 'HEAD']).decode().strip()
    if current != source_sha:
        raise RuntimeError('Repository SHA changed during reproduction')
    if digest(recipe.read_bytes()) != recipe_hash or subprocess.check_output(['git', '-C', str(root), 'status', '--porcelain', '--untracked-files=all', '--', 'public/zk']):
        raise RuntimeError('Recipe or circuit inputs changed during reproduction')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--receipt', type=pathlib.Path)
    args = parser.parse_args()
    output = ROOT / 'zkbuild'
    if output.is_symlink():
        raise RuntimeError('Refusing a symlinked receipt directory')
    output.mkdir(exist_ok=True)
    receipt = args.receipt or output / 'cubic-provenance.json'
    if receipt.is_symlink():
        raise RuntimeError('Refusing a symlinked receipt')
    recipe_hash = digest(pathlib.Path(__file__).read_bytes())
    report = dict(startedAt=datetime.datetime.now(datetime.timezone.utc).isoformat(), state='incomplete',
                  sourceSha=None, originalCompiler=None, originalSetupInputs=None, commands=[],
                  recipeSha256=recipe_hash, platform=dict(system=platform.system(), machine=platform.machine()),
                  scope='Current immutable circuit reproduces shipped witness WASM. Setup keys, ceremony trust, vendored snarkjs source reproduction and constant-time behavior are not established.')
    def save():
        receipt.write_text(json.dumps(report, indent=2) + '\n')
    def run(command, cwd, env):
        return run_command(command, cwd, env, report, save)
    save()
    try:
        if (platform.system(), platform.machine()) not in {('Darwin', 'arm64'), ('Linux', 'x86_64')}:
            raise RuntimeError('Unsupported build host; no unverified fallback')
        with tempfile.TemporaryDirectory(prefix='snark-cubic-reproduction-') as temporary:
            work = pathlib.Path(temporary)
            captured = work / 'captured'
            report['sourceSha'], report['sourceInputs'] = capture_source(ROOT, captured)
            url = 'https://codeload.github.com/iden3/circom/tar.gz/' + CIRCOM_COMMIT
            archive = work / 'circom-source.tar.gz'
            with urllib.request.urlopen(url, timeout=60) as response:
                archive.write_bytes(response.read())
            unpack_verified(archive, ARCHIVE_SHA256, work / 'compiler-source')
            source = work / 'compiler-source' / ('circom-' + CIRCOM_COMMIT)
            packages = registry_packages(source / 'Cargo.lock')
            report['circomSource'] = dict(commit=CIRCOM_COMMIT, url=url, archiveSha256=ARCHIVE_SHA256,
                                         cargoLockSha256=LOCK_SHA256, registryPackages=packages)
            env = {key: os.environ[key] for key in ('PATH', 'HOME', 'RUSTUP_HOME', 'TMPDIR') if key in os.environ}
            cargo_home = work / 'cargo-home'
            env.update(CARGO_HOME=str(cargo_home), CARGO_TARGET_DIR=str(work / 'compiler-target'),
                       CARGO_INCREMENTAL='0', CARGO_TERM_COLOR='never', RUSTUP_TOOLCHAIN='1.87.0')
            rustup = shutil.which('rustup', path=env['PATH'])
            if not rustup and env.get('HOME'):
                candidate = pathlib.Path(env['HOME']) / '.cargo/bin/rustup'
                if candidate.is_file():
                    rustup = str(candidate)
            if not rustup:
                raise RuntimeError('rustup is required; refusing an unrelated system compiler')
            run([rustup, 'toolchain', 'install', '1.87.0', '--profile', 'minimal', '--no-self-update'], source, env)
            rustc = run([rustup, 'which', 'rustc', '--toolchain', '1.87.0'], source, env)
            cargo = run([rustup, 'which', 'cargo', '--toolchain', '1.87.0'], source, env)
            env['PATH'] = str(pathlib.Path(cargo).parent) + os.pathsep + env['PATH']
            env['RUSTC'] = rustc
            identity = run([rustc, '-vV'], source, env)
            validate_compiler(identity)
            report['rust'] = dict(identity=identity, path=rustc, executableSha256=digest(pathlib.Path(rustc).read_bytes()))
            report['cargo'] = dict(identity=run([cargo, '-V'], source, env), path=cargo,
                                   executableSha256=digest(pathlib.Path(cargo).read_bytes()))
            cc = shutil.which('cc', path=env['PATH'])
            if not cc:
                raise RuntimeError('Host C compiler is unavailable for the Circom build')
            report['hostCCompiler'] = dict(path=cc, identity=run([cc, '--version'], source, env))
            run([cargo, 'fetch', '--locked', '--manifest-path', str(source / 'Cargo.toml')], source, env)
            verify_registry_archives(packages, cargo_home)
            run([cargo, 'build', '--release', '--locked', '--offline', '--manifest-path', str(source / 'Cargo.toml')], source, env)
            binary = work / 'compiler-target/release/circom'
            version = run([str(binary), '--version'], work, env)
            if version != 'circom compiler 2.2.3':
                raise RuntimeError('Unexpected actual Circom compiler')
            report['circom'] = dict(identity=version, executableSha256=digest(binary.read_bytes()))
            report['compileFlags'] = ['--r1cs', '--wasm', '-p', 'bn128']
            for label in ('first', 'second'):
                circuit = work / label
                shutil.copytree(captured, circuit)
                (circuit / 'build').mkdir()
                run([str(binary), CIRCUIT, *report['compileFlags'], '-o', 'build'], circuit, env)
            report['artifacts'] = compare_artifacts(work / 'first/build', work / 'second/build', captured / SHIPPED)
            verify_unchanged(ROOT, report['sourceSha'], pathlib.Path(__file__), recipe_hash)
            if digest((source / 'Cargo.lock').read_bytes()) != LOCK_SHA256:
                raise RuntimeError('Compiler dependency lock changed during build')
            report['state'] = 'reproduced-shipped-wasm'
    except BaseException as error:
        report.update(state='failed', error=str(error))
        raise
    finally:
        report['finishedAt'] = datetime.datetime.now(datetime.timezone.utc).isoformat()
        save()
    print(json.dumps(dict(state=report['state'], sourceSha=report['sourceSha'], artifacts=report['artifacts'], receipt=str(receipt))))


if __name__ == '__main__':
    main()
