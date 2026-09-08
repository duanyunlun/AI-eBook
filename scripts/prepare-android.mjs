import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';

const app = resolve('src-tauri/gen/android/app');
const artifacts = resolve('.build-cache/android-node');
const architecture = process.argv[2];
assert.ok(!architecture || ['arm64', 'x64'].includes(architecture), '仅支持 arm64 或 x64');
const targets = [['arm64', 'arm64-v8a'], ['x64', 'x86_64']].filter(([arch]) => !architecture || arch === architecture);
for (const [arch, abi] of targets) {
  const runtime = resolve(artifacts, `android-node-${arch}`);
  assert.equal((await readFile(resolve(runtime, 'version.txt'), 'utf8')).trim(), 'v24.20.0');
  const destination = resolve(app, 'src/main/jniLibs', abi);
  await mkdir(destination, { recursive: true });
  await cp(resolve(runtime, 'libnode_runtime.so'), resolve(destination, 'libnode_runtime.so'));
}
const assets = resolve(app, 'src/main/assets/node-runtime');
await mkdir(assets, { recursive: true });
for (const name of ['npm', 'version.txt', 'LICENSE-Node.txt']) {
  await cp(resolve(artifacts, `android-node-${targets[0][0]}`, name), resolve(assets, name), { recursive: true });
}
assert.ok(process.env.ANDROID_HOME);
const cpuFeatures = await readFile(resolve(process.env.ANDROID_HOME, 'ndk/27.2.12479018/sources/android/cpufeatures/cpu-features.c'), 'utf8');
assert.ok(cpuFeatures.startsWith('/*') && cpuFeatures.includes('*/'));
await writeFile(resolve(assets, 'LICENSE-Android-cpufeatures.txt'), cpuFeatures.slice(0, cpuFeatures.indexOf('*/') + 2));
await cp('src-tauri/android/BookPickerPlugin.kt', resolve(app, 'src/main/java/app/aiebook/reader/BookPickerPlugin.kt'));
const gradlePath = resolve(app, 'build.gradle.kts');
let gradle = await readFile(gradlePath, 'utf8');
assert.ok(gradle.includes('android {'));
if (!gradle.includes('jniLibs.useLegacyPackaging = true')) {
  gradle = gradle.replace('android {', 'android {\n    packaging { jniLibs.useLegacyPackaging = true }');
  await writeFile(gradlePath, gradle);
}
if (!gradle.includes('AI_EBOOK_ANDROID_KEYSTORE')) {
  gradle = gradle.replace('android {', `android {
    System.getenv("AI_EBOOK_ANDROID_KEYSTORE")?.let { path ->
        signingConfigs.getByName("debug") {
            storeFile = file(path)
            storeType = "PKCS12"
            storePassword = System.getenv("AI_EBOOK_ANDROID_STORE_PASSWORD")
            keyAlias = "ai-ebook-preview"
            keyPassword = storePassword
        }
    }`);
  await writeFile(gradlePath, gradle);
}
const manifestPath = resolve(app, 'src/main/AndroidManifest.xml');
let manifest = await readFile(manifestPath, 'utf8');
assert.ok(manifest.includes('<application'));
manifest = manifest.includes('android:extractNativeLibs=')
  ? manifest.replace(/android:extractNativeLibs="[^"]*"/, 'android:extractNativeLibs="true"')
  : manifest.replace('<application', '<application android:extractNativeLibs="true"');
await writeFile(manifestPath, manifest);
