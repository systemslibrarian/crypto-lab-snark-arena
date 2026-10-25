"""Offline positive and negative controls; real compiler builds run separately."""
import hashlib
import importlib.util
import io
import json
import pathlib
import subprocess
import sys
import tarfile
import tempfile
import unittest
from unittest.mock import patch

ROOT = pathlib.Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('gate', ROOT / 'scripts/verify-cubic-wasm.py')
gate = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gate)


class ProvenanceControls(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = pathlib.Path(temporary.name)

    def test_real_command_failure_preserves_diagnostic_and_status(self):
        report, saves = {'commands': []}, []
        with self.assertRaisesRegex(RuntimeError, 'Command failed'):
            gate.run_command([sys.executable, '-c', 'print("diagnostic"); raise SystemExit(7)'],
                             self.root, {}, report, lambda: saves.append(True))
        self.assertEqual(report['commands'][0]['exit'], 7)
        self.assertIn('diagnostic', report['commands'][0]['stdout'])
        self.assertEqual(saves, [True])

    def test_real_timeout_preserves_partial_output_and_is_not_success(self):
        report = {'commands': []}
        with self.assertRaisesRegex(RuntimeError, 'timed out'):
            gate.run_command([sys.executable, '-c', 'import time; print("partial", flush=True); time.sleep(2)'],
                             self.root, {}, report, lambda: None, timeout=0.2)
        self.assertIsNone(report['commands'][0]['exit'])
        self.assertTrue(report['commands'][0]['timedOut'])
        self.assertIn('partial', report['commands'][0]['stdout'])

    def test_missing_executable_is_not_success(self):
        report = {'commands': []}
        with self.assertRaisesRegex(RuntimeError, 'unavailable'):
            gate.run_command([str(self.root / 'absent')], self.root, {}, report, lambda: None)
        self.assertTrue(report['commands'][0]['unavailable'])
        self.assertIsNone(report['commands'][0]['exit'])

    def test_failed_collection_replaces_old_success_without_changing_shipped_bytes(self):
        (self.root / 'zkbuild').mkdir()
        receipt = self.root / 'zkbuild/cubic-provenance.json'
        receipt.write_text('{"state":"reproduced-shipped-wasm"}')
        (self.root / 'public/zk').mkdir(parents=True)
        (self.root / 'scripts').mkdir()
        (self.root / gate.ARTIFACT_CHECKER).write_text('// fixture\n')
        shipped = self.root / gate.SHIPPED
        shipped.write_bytes(b'previous shipped bytes')
        with patch.object(gate, 'ROOT', self.root), patch.object(sys, 'argv', ['verify-cubic-wasm.py']), \
                patch.object(gate.platform, 'system', return_value='unsupported'), \
                self.assertRaisesRegex(RuntimeError, 'Unsupported build host'):
            gate.main()
        self.assertEqual(json.loads(receipt.read_text())['state'], 'failed')
        self.assertEqual(shipped.read_bytes(), b'previous shipped bytes')

    def pair(self):
        first, second, captured = self.root / 'first', self.root / 'second', self.root / 'captured'
        for spec in gate.CIRCUITS:
            for destination in (first, second):
                (destination / (spec['name'] + '_js')).mkdir(parents=True, exist_ok=True)
                (destination / (spec['name'] + '_js') / (spec['name'] + '.wasm')).write_bytes(
                    b'\0asm\x01\0\0\0\x00fixture-' + spec['name'].encode())
                (destination / (spec['name'] + '.r1cs')).write_bytes(
                    b'r1cs\x01\0\0\0fixture-' + spec['name'].encode())
            shipped = captured / spec['wasm']
            shipped.parent.mkdir(parents=True, exist_ok=True)
            shipped.write_bytes((first / (spec['name'] + '_js') / (spec['name'] + '.wasm')).read_bytes())
        return first, second, captured

    def test_equal_pair_and_shipped_match(self):
        rows = gate.compare_artifacts(*self.pair())
        self.assertEqual(len(rows), len(gate.CIRCUITS) * 2)
        self.assertTrue(all(row['repeatMatches'] for row in rows))
        self.assertTrue(all(row['matchesShipped'] for row in rows if row['path'].endswith('.wasm')))
        self.assertTrue(all(row['historicalR1csComparison'] == 'not-available'
                            for row in rows if row['path'].endswith('.r1cs')))

    def test_one_changed_build_byte_rejected(self):
        first, second, captured = self.pair()
        shipped = captured / gate.SHIPPED
        (second / 'cubic_js/cubic.wasm').write_bytes(shipped.read_bytes() + b'changed')
        with self.assertRaisesRegex(RuntimeError, 'clean circuit builds differ'):
            gate.compare_artifacts(first, second, captured)

    def test_two_equal_builds_are_insufficient_if_shipped_differs(self):
        first, second, captured = self.pair()
        shipped = captured / gate.SHIPPED
        shipped.write_bytes(shipped.read_bytes() + b'changed')
        with self.assertRaisesRegex(RuntimeError, 'differs from captured shipped'):
            gate.compare_artifacts(first, second, captured)

    def test_missing_shipped_or_generated_artifact_is_not_success(self):
        for missing in (gate.SHIPPED, 'second/cubic.r1cs'):
            with self.subTest(missing=missing):
                # Recreate independent inputs for each control.
                with tempfile.TemporaryDirectory(dir=self.root) as temporary:
                    old = self.root; self.root = pathlib.Path(temporary)
                    try:
                        first, second, captured = self.pair()
                        target = captured / missing if missing == gate.SHIPPED else self.root / missing
                        target.unlink()
                        with self.assertRaises(FileNotFoundError):
                            gate.compare_artifacts(first, second, captured)
                    finally:
                        self.root = old

    def test_equal_empty_or_header_only_artifacts_rejected(self):
        first, second, captured = self.pair()
        for value in (b'', b'\0asm\x01\0\0\0'):
            for directory in (first, second):
                (directory / 'cubic_js/cubic.wasm').write_bytes(value)
            with self.assertRaisesRegex(RuntimeError, 'Empty or incomplete'):
                gate.compare_artifacts(first, second, captured)

    def test_equal_malformed_outputs_rejected(self):
        first, second, captured = self.pair()
        for directory in (first, second):
            (directory / 'cubic_js/cubic.wasm').write_bytes(b'not a WASM binary')
        with self.assertRaisesRegex(RuntimeError, 'Malformed'):
            gate.compare_artifacts(first, second, captured)

    def test_equal_wasm_with_different_r1cs_rejected(self):
        first, second, captured = self.pair()
        (second / 'cubic.r1cs').write_bytes(b'r1cs\x01\0\0\0changed')
        with self.assertRaisesRegex(RuntimeError, 'clean circuit builds differ'):
            gate.compare_artifacts(first, second, captured)

    def archive(self, name='source/file', link=False):
        archive = self.root / 'archive.tar.gz'
        with tarfile.open(archive, 'w:gz') as bundle:
            info = tarfile.TarInfo(name)
            if link:
                info.type = tarfile.SYMTYPE; info.linkname = '/outside'
                bundle.addfile(info)
            else:
                info.size = 5; bundle.addfile(info, io.BytesIO(b'file\n'))
        return archive

    def test_verified_source_archive_extracts(self):
        archive = self.archive()
        gate.unpack_verified(archive, gate.digest(archive.read_bytes()), self.root / 'out')
        self.assertEqual((self.root / 'out/source/file').read_bytes(), b'file\n')

    def test_wrong_archive_hash_rejected_before_extraction(self):
        with self.assertRaisesRegex(RuntimeError, 'hash mismatch'):
            gate.unpack_verified(self.archive(), '0' * 64, self.root / 'out')
        self.assertFalse((self.root / 'out').exists())

    def test_escape_and_symlink_rejected_even_with_matching_hash(self):
        for name, link in [('../escaped', False), ('/absolute', False), ('source/link', True)]:
            archive = self.archive(name, link)
            with self.subTest(name=name), self.assertRaisesRegex(RuntimeError, 'Unsafe'):
                gate.unpack_verified(archive, gate.digest(archive.read_bytes()), self.root / 'out')

    def identity(self):
        return ('rustc 1.87.0 (17067e9ac 2025-05-09)\nbinary: rustc\ncommit-hash: ' + gate.RUST_COMMIT +
                '\nhost: aarch64-apple-darwin\nrelease: 1.87.0\nLLVM version: 20.1.1\n')

    def test_exact_actual_rust_identity(self):
        gate.validate_compiler(self.identity())

    def test_wrong_missing_or_ambiguous_rust_identity_rejected(self):
        for identity in (self.identity().replace('1.87.0', '1.99.0'),
                         self.identity().replace('LLVM version: 20.1.1\n', ''),
                         self.identity() + 'release: 1.99.0\n'):
            with self.subTest(identity=identity), self.assertRaises(RuntimeError):
                gate.validate_compiler(identity)

    def test_locked_public_dependency_archive_and_tamper(self):
        data = b'public fixture crate'
        package = dict(name='fixture', version='1.0.0', checksum=hashlib.sha256(data).hexdigest())
        cache = self.root / 'registry/cache/crates-io'; cache.mkdir(parents=True)
        path = cache / 'fixture-1.0.0.crate'; path.write_bytes(data)
        gate.verify_registry_archives([package], self.root)
        path.write_bytes(data + b'changed')
        with self.assertRaisesRegex(RuntimeError, 'changed locked dependency'):
            gate.verify_registry_archives([package], self.root)

    def test_missing_locked_dependency_archive_rejected(self):
        with self.assertRaisesRegex(RuntimeError, 'Missing'):
            gate.verify_registry_archives([dict(name='fixture', version='1.0.0', checksum='0'*64)], self.root)

    def test_changed_dependency_lock_rejected(self):
        lock = self.root / 'Cargo.lock'; lock.write_text('version=4\n')
        with self.assertRaisesRegex(RuntimeError, 'lock hash mismatch'):
            gate.registry_packages(lock)

    def test_unknown_provider_and_incomplete_lock_rejected(self):
        lock = self.root / 'Cargo.lock'
        for value in ('version=4\n', '[[package]]\nname="fixture"\nversion="1.0.0"\nsource="git+https://example.invalid/private"\n'):
            lock.write_text(value)
            with patch.object(gate, 'LOCK_SHA256', gate.digest(lock.read_bytes())), self.assertRaises(RuntimeError):
                gate.registry_packages(lock)

    def git(self, *args):
        return subprocess.check_output(['git', '-C', str(self.root), *args], stderr=subprocess.PIPE)

    def source_repo(self):
        self.git('init', '-q', '--initial-branch=main')
        real_bundle = (ROOT / gate.SNARKJS_BUNDLE).read_bytes()
        for name in gate.EXPECTED_CAPTURE_INPUTS:
            if name == gate.SNARKJS_BUNDLE:
                data = real_bundle
            elif name == gate.ARTIFACT_CHECKER:
                data = b'// fixture artifact checker\n'
            elif name.endswith('.circom'):
                data = b'pragma circom 2.0.0;\n'
            elif name.endswith('.wasm'):
                data = b'\0asm\x01\0\0\0fixture'
            elif name.endswith('.json'):
                data = b'{}\n'
            else:
                data = b'fixture binary\n'
            path = self.root / name; path.parent.mkdir(parents=True, exist_ok=True); path.write_bytes(data)
        self.git('add', 'public', 'scripts')
        self.git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'source fixture')

    def commit(self):
        self.git('add', 'public/zk')
        self.git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'control')

    def test_immutable_git_capture_hashes_exact_bytes(self):
        self.source_repo()
        sha, rows = gate.capture_source(self.root, self.root / 'copy')
        self.assertEqual(sha, self.git('rev-parse', 'HEAD').decode().strip())
        self.assertEqual(len(rows), len(gate.EXPECTED_CAPTURE_INPUTS))
        for row in rows:
            blob = self.git('cat-file', 'blob', row['gitBlob'])
            self.assertEqual((self.root / 'copy' / row['path']).read_bytes(), blob)
            self.assertEqual(row['sha256'], gate.digest(blob))

    def test_dirty_or_new_inputs_rejected_without_erasure(self):
        self.source_repo()
        path = self.root / 'public/zk/new.circom'; path.write_text('uncommitted')
        with self.assertRaisesRegex(RuntimeError, 'Uncommitted'):
            gate.capture_source(self.root, self.root / 'copy')
        self.assertEqual(path.read_text(), 'uncommitted')

    def test_changed_repository_sha_rejected(self):
        self.source_repo()
        sha = self.git('rev-parse', 'HEAD').decode().strip()
        recipe = self.root / 'recipe'; recipe.write_text('recipe')
        gate.verify_unchanged(self.root, sha, [(recipe, gate.digest(recipe.read_bytes()))])
        (self.root / gate.CIRCUIT).write_text('new committed circuit')
        self.commit()
        with self.assertRaisesRegex(RuntimeError, 'Repository SHA changed'):
            gate.verify_unchanged(self.root, sha, [(recipe, gate.digest(recipe.read_bytes()))])

    def test_changed_recipe_and_dirty_source_rejected(self):
        self.source_repo()
        sha = self.git('rev-parse', 'HEAD').decode().strip()
        recipe = self.root / 'recipe'; recipe.write_text('recipe')
        expected = gate.digest(recipe.read_bytes())
        recipe.write_text('changed recipe')
        with self.assertRaisesRegex(RuntimeError, 'Recipe or circuit inputs changed'):
            gate.verify_unchanged(self.root, sha, [(recipe, expected)])
        recipe.write_text('recipe')
        (self.root / gate.CIRCUIT).write_text('changed source')
        with self.assertRaisesRegex(RuntimeError, 'Recipe or circuit inputs changed'):
            gate.verify_unchanged(self.root, sha, [(recipe, expected)])

    def test_wrong_source_sha_rejected(self):
        with patch.object(gate.subprocess, 'check_output', return_value=b'not-a-sha\n'), \
                self.assertRaisesRegex(RuntimeError, 'Invalid source SHA'):
            gate.capture_source(self.root, self.root / 'copy')

    def test_missing_tracked_circuit_input_rejected(self):
        self.source_repo(); self.git('rm', '-q', gate.SHIPPED); self.commit()
        with self.assertRaisesRegex(RuntimeError, 'Incomplete'):
            gate.capture_source(self.root, self.root / 'copy')

    def test_additional_included_or_symlinked_inputs_rejected(self):
        for kind in ('additional', 'include', 'symlink'):
            with tempfile.TemporaryDirectory(dir=self.root) as temporary:
                old = self.root; self.root = pathlib.Path(temporary)
                try:
                    self.source_repo()
                    if kind == 'additional':
                        (self.root / 'public/zk/extra.circom').write_text('pragma circom 2.0.0;')
                    elif kind == 'include':
                        (self.root / gate.CIRCUIT).write_text('include "outside.circom";\n')
                    else:
                        (self.root / 'public/zk/link').symlink_to('/outside')
                    self.commit()
                    with self.subTest(kind=kind), self.assertRaises(RuntimeError):
                        gate.capture_source(self.root, self.root / 'copy')
                finally:
                    self.root = old


if __name__ == '__main__':
    unittest.main()
