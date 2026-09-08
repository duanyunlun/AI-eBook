from pathlib import Path
import struct
import zipfile

packages = list(Path('src-tauri/gen/android/app/build/outputs/apk').rglob('*.apk'))
assert len(packages) >= 2, '缺少 Android 架构安装包'
architectures = set()
for package in packages:
    with zipfile.ZipFile(package) as archive:
        libraries = [name for name in archive.namelist() if name.startswith('lib/') and name.endswith('.so')]
        assert any(name.endswith('/libnode_runtime.so') for name in libraries), 'APK 缺少 Node'
        assert any(name.endswith('/libai_ebook_lib.so') for name in libraries), 'APK 缺少阅读器'
        for name in libraries:
            data = archive.read(name)
            assert data[:6] == b'\x7fELF\x02\x01', f'不是 64 位小端 ELF：{name}'
            architecture = name.split('/')[1]
            assert struct.unpack_from('<H', data, 18)[0] == {'arm64-v8a': 183, 'x86_64': 62}[architecture]
            architectures.add(architecture)
            offset = struct.unpack_from('<Q', data, 32)[0]
            size, count = struct.unpack_from('<HH', data, 54)
            segments = [struct.unpack_from('<IIQQQQQQ', data, offset + index * size) for index in range(count)]
            loads = [segment for segment in segments if segment[0] == 1]
            assert loads and all(segment[7] >= 16384 and (segment[3] - segment[2]) % 16384 == 0 for segment in loads), f'未按 16 KB 对齐：{name}'
        print(f'PASS {package.name}：Node、阅读器架构与 16 KB ELF 对齐')
assert architectures == {'arm64-v8a', 'x86_64'}
