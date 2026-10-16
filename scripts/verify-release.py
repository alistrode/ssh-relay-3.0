#!/usr/bin/env python3
"""Verify shipped runtime packages against the checked-in executable sources."""
import hashlib
from pathlib import Path, PurePosixPath
import subprocess
import tarfile
import zipfile

ROOT = Path(__file__).resolve().parents[1]
DOWNLOADS = ROOT / 'downloads'


def require(condition, message):
    if not condition:
        raise SystemExit(message)


def archive_files(path):
    if path.suffix == '.zip':
        with zipfile.ZipFile(path) as archive:
            require(archive.testzip() is None, f'Corrupt ZIP: {path.name}')
            return {n: archive.read(n) for n in archive.namelist() if not n.endswith('/')}
    with tarfile.open(path) as archive:
        return {m.name: archive.extractfile(m).read() for m in archive.getmembers() if m.isfile()}


def local_files(path):
    return {p.relative_to(path).as_posix(): p.read_bytes()
            for p in path.rglob('*') if p.is_file() and '__pycache__' not in p.parts}


def main():
    checksums = {}
    for line in (DOWNLOADS / 'SHA256SUMS.txt').read_text().splitlines():
        digest, name = line.split(maxsplit=1)
        checksums[name] = digest
        require(hashlib.sha256((DOWNLOADS / name).read_bytes()).hexdigest() == digest,
                f'Checksum mismatch: {name}')
    expected = {f'connect-{p}-public-ssh-skill.zip' for p in ('linux', 'win10')}
    expected.update(('ssh-remote-linux-portable.tar.xz', 'ssh-remote-win10-portable.zip'))
    require(set(checksums) == expected, 'Checksum manifest must cover all four release packages')

    for platform in ('linux', 'win10'):
        skill = f'connect-{platform}-public-ssh'
        shipped = archive_files(DOWNLOADS / f'{skill}-skill.zip')
        require(shipped == {f'{skill}/{n}': data for n, data in
                            local_files(ROOT / '.agents/skills' / skill).items()},
                f'Skill archive differs from checked-in files: {platform}')
        skill_root = ROOT / '.agents/skills' / skill
        compile((skill_root / 'scripts/connect.py').read_text(), 'connect.py', 'exec')
        subprocess.run(['node', '--check', str(skill_root / 'scripts/assets/near.cjs')], check=True)

        suffix = '.tar.xz' if platform == 'linux' else '.zip'
        shipped = archive_files(DOWNLOADS / f'ssh-remote-{platform}-portable{suffix}')
        prefix = f'ssh-remote-{platform}-portable/'
        require(all(n.startswith(prefix) and '..' not in PurePosixPath(n).parts for n in shipped),
                f'Unexpected archive paths: {platform}')
        files = {n[len(prefix):]: data for n, data in shipped.items()}
        require(not any(n.startswith(('data/', 'logs/')) for n in files),
                f'Runtime state included: {platform}')
        runtime = 'runtime/node' if platform == 'linux' else 'runtime/node.exe'
        require(runtime in files and len(files[runtime]) > 1_000_000,
                f'Bundled Node missing: {platform}')
        sources = {n: data for n, data in files.items() if not n.startswith('runtime/')}
        require(sources == local_files(ROOT / 'remote' / platform),
                f'Remote source differs from release: {platform}')
        subprocess.run(['node', '--check', str(ROOT / 'remote' / platform / 'app/start.cjs')], check=True)
        print(f'{platform}: skill, remote source, bundled runtime and release checksums OK')
    subprocess.run(['bash', '-n', str(ROOT / 'remote/linux/start.sh')], check=True)
    print('All release integrity and syntax checks passed.')


if __name__ == '__main__':
    main()
