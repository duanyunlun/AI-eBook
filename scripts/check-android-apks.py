from pathlib import Path
import os
import struct
import subprocess
import sys
import zipfile

assert len(sys.argv) <= 2 and (len(sys.argv) == 1 or sys.argv[1] in ('arm64', 'x64'))
expected = {'arm64-v8a', 'x86_64'} if len(sys.argv) == 1 else {{'arm64': 'arm64-v8a', 'x64': 'x86_64'}[sys.argv[1]]}
packages = list(Path('src-tauri/gen/android/app/build/outputs/apk').rglob('*.apk'))
assert len(packages) >= len(expected), '缺少 Android 架构安装包'
architectures = set()
for package in packages:
    signer = Path(os.environ['ANDROID_HOME']) / 'build-tools/35.0.0/apksigner'
    certificate = subprocess.check_output([str(signer), 'verify', '--print-certs', str(package)], text=True)
    assert 'Signer #1 certificate SHA-256 digest: 82d9aeaf645261256b275deb3f41b745aa14eb4815320d4c59c61c1878dadb41' in certificate, 'APK 未使用固定预览签名'
    with zipfile.ZipFile(package) as archive:
        libraries = [name for name in archive.namelist() if name.startswith('lib/') and name.endswith('.so')]
        assert any(name.endswith('/libnode_runtime.so') for name in libraries), 'APK 缺少 Node'
        assert any(name.endswith('/libai_ebook_lib.so') for name in libraries), 'APK 缺少阅读器'
        for name in libraries:
            data = archive.read(name)
            assert data[:6] == b'\x7fELF\x02\x01', f'不是 64 位小端 ELF：{name}'
            assert struct.unpack_from('<H', data, 16)[0] == 3, f'不是可重定位 ELF：{name}'
            if name.endswith('/libnode_runtime.so'):
                assert struct.unpack_from('<Q', data, 24)[0] != 0, 'Node 缺少可执行入口'
            architecture = name.split('/')[1]
            assert struct.unpack_from('<H', data, 18)[0] == {'arm64-v8a': 183, 'x86_64': 62}[architecture]
            architectures.add(architecture)
            offset = struct.unpack_from('<Q', data, 32)[0]
            size, count = struct.unpack_from('<HH', data, 54)
            segments = [struct.unpack_from('<IIQQQQQQ', data, offset + index * size) for index in range(count)]
            loads = [segment for segment in segments if segment[0] == 1]
            assert loads and all(segment[7] >= 16384 and (segment[3] - segment[2]) % 16384 == 0 for segment in loads), f'未按 16 KB 对齐：{name}'
        print(f'PASS {package.name}：固定签名、Node、阅读器架构与 16 KB ELF 对齐')
assert architectures == expected
