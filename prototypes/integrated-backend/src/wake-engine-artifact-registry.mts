/** Pinned official runtime/model files; no audio fixtures or local paths. */
export const WAKE_ARTIFACT_REGISTRY = {
  "contract": "aerynth.local-wake-artifacts@1",
  "engine": "sherpa-onnx",
  "version": "2.0.1",
  "onnxruntimeVersion": "1.28.2",
  "modelId": "sherpa-onnx-kws-zipformer-gigaspeech-3.3M-2024-01-01-int8",
  "modelLicense": "Apache-2.0",
  "runtimeLicenses": [
    "Apache-2.0",
    "MIT"
  ],
  "roles": {
    "package": "node_modules/sherpa-onnx-node/package.json",
    "encoder": "model/encoder-epoch-12-avg-2-chunk-16-left-64.int8.onnx",
    "decoder": "model/decoder-epoch-12-avg-2-chunk-16-left-64.int8.onnx",
    "joiner": "model/joiner-epoch-12-avg-2-chunk-16-left-64.int8.onnx",
    "tokens": "model/tokens.txt",
    "bpe": "model/bpe.model"
  },
  "files": [
    {
      "path": "licenses/ONNXRUNTIME-MIT.txt",
      "bytes": 1073,
      "sha256": "2f07c72751aed99790b8a4869cf2311df85a860b22ded05fa22803587a48922c"
    },
    {
      "path": "licenses/ONNXRUNTIME-THIRD-PARTY-NOTICES.txt",
      "bytes": 325054,
      "sha256": "0e07b95f3a8d6230037707c5c4a2b554d12c4cb67369669ac255635528ffcee2"
    },
    {
      "path": "licenses/SHERPA-APACHE-2.0.txt",
      "bytes": 11358,
      "sha256": "cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30"
    },
    {
      "path": "model/bpe.model",
      "bytes": 244837,
      "sha256": "c8a2a0129c4ab8e463164c142f82d25649661b122c8cd0b7aab5c9e80b90ad24"
    },
    {
      "path": "model/decoder-epoch-12-avg-2-chunk-16-left-64.int8.onnx",
      "bytes": 277985,
      "sha256": "e40ff43297abe815e8898494c17e71bba2152d9d40fa3eb803f75d0f7533329a"
    },
    {
      "path": "model/encoder-epoch-12-avg-2-chunk-16-left-64.int8.onnx",
      "bytes": 4807159,
      "sha256": "1e721676515bcd42a186979733981213c66c80db680e1cc582dfedf3be76e678"
    },
    {
      "path": "model/joiner-epoch-12-avg-2-chunk-16-left-64.int8.onnx",
      "bytes": 163380,
      "sha256": "eae9da0c7e1e6c6a3f4cc42d167899c388f6c6701b94cb96320e4f55df79624c"
    },
    {
      "path": "model/README.md",
      "bytes": 726,
      "sha256": "74e42d37d63acd2366b042151d576fcc0c4917a41de339414a37f1e79f4e80e2"
    },
    {
      "path": "model/tokens.txt",
      "bytes": 5006,
      "sha256": "fd2ded4050a55d2b1578870ba8697d02371980217806b7558bd0a5cc60f3ba53"
    },
    {
      "path": "node_modules/sherpa-onnx-node/addon-static-import.js",
      "bytes": 2492,
      "sha256": "5eb1b8b13b33735f95e80dcb9b5a40d9725f7d41394c1496ce61d1d087667c9c"
    },
    {
      "path": "node_modules/sherpa-onnx-node/addon.js",
      "bytes": 2760,
      "sha256": "ccdfdd81775611bb1b4de2f30fc22a987f9d6936b280c91b6a0c597e02f3c839"
    },
    {
      "path": "node_modules/sherpa-onnx-node/audio-tagg.js",
      "bytes": 1285,
      "sha256": "4f38deacb6fd0dddc6adb717f54f515079a2bb8c7c077d45a4f59d7ed88664a5"
    },
    {
      "path": "node_modules/sherpa-onnx-node/keyword-spotter.js",
      "bytes": 1609,
      "sha256": "de79f3c50dba37be650e8f3688f56cd1a6c400f1074d9034ed99f82941e74439"
    },
    {
      "path": "node_modules/sherpa-onnx-node/non-streaming-asr.js",
      "bytes": 4509,
      "sha256": "768f5afe411e1f960c0e5c59d6bec8120520461704f2786fb110667ed3eeefea"
    },
    {
      "path": "node_modules/sherpa-onnx-node/non-streaming-speaker-diarization.js",
      "bytes": 1164,
      "sha256": "ec2d8bae9365d6d1d6b43bb6ae31d641c7c7bce3cf31f1adb96cfed0d53b9233"
    },
    {
      "path": "node_modules/sherpa-onnx-node/non-streaming-speech-denoiser.js",
      "bytes": 993,
      "sha256": "86b2562f53078f6bfa39895b77984e43556717de94cdf38b39cb9b4d0670ae52"
    },
    {
      "path": "node_modules/sherpa-onnx-node/non-streaming-tts.js",
      "bytes": 3220,
      "sha256": "0e59318cefbfaaf3d9247ee0b772595f2afcac039ffa79f91b2aa31bfc92e56f"
    },
    {
      "path": "node_modules/sherpa-onnx-node/online-speech-denoiser.js",
      "bytes": 1286,
      "sha256": "40c060d62e8080e4d37fbc4bce37273afaadd42ad19ff3f6ce35c008755b7eef"
    },
    {
      "path": "node_modules/sherpa-onnx-node/package.json",
      "bytes": 1701,
      "sha256": "ddecdea9a1216cf8b25f09d13fef1dcb0aef5cbf50fb8bdb388c9a8303a9350b"
    },
    {
      "path": "node_modules/sherpa-onnx-node/punctuation.js",
      "bytes": 1186,
      "sha256": "723f7fd4920906418067ad5b63f1e5bdd12ccbce6f9af49c5dfc74e767bbaa2f"
    },
    {
      "path": "node_modules/sherpa-onnx-node/README.md",
      "bytes": 343,
      "sha256": "5706568eaac6a98ce8c7da76c5676086010b68254d0a0c307b742cb6357afb0b"
    },
    {
      "path": "node_modules/sherpa-onnx-node/resampler.js",
      "bytes": 2216,
      "sha256": "49f0eeaed2d256ad442e56a74182b3848dd276b96351a1adf9ff9a0928162dae"
    },
    {
      "path": "node_modules/sherpa-onnx-node/sherpa-onnx.js",
      "bytes": 2080,
      "sha256": "120bb60c0f9042236573236abf44935c8403fa7e27cd6cbb3cbd08fe3900271a"
    },
    {
      "path": "node_modules/sherpa-onnx-node/speaker-identification.js",
      "bytes": 3912,
      "sha256": "811ab1d07005c110593bbf3a3e17deeb6b1763b4f46f25c793554a41afa01aa2"
    },
    {
      "path": "node_modules/sherpa-onnx-node/spoken-language-identification.js",
      "bytes": 1120,
      "sha256": "d7faace010316d0eb200e5afbef9fe3a6d2a2dbeab317c7f23fa2e685cb65a26"
    },
    {
      "path": "node_modules/sherpa-onnx-node/streaming-asr.js",
      "bytes": 4576,
      "sha256": "e201af0cf90abbfdd6cb4336c2262d4d85142de09829f7f0f0efe546412d110a"
    },
    {
      "path": "node_modules/sherpa-onnx-node/types.js",
      "bytes": 24730,
      "sha256": "3fa418208be9c6439152511a1daa89b869f4c001bacdeff1d2253ee377e7a4c2"
    },
    {
      "path": "node_modules/sherpa-onnx-node/vad.js",
      "bytes": 2971,
      "sha256": "516759499cfd4479f6feaf8dd81452d8189c4909ad402923dd983fba71496c38"
    },
    {
      "path": "node_modules/sherpa-onnx-win-x64/index.js",
      "bytes": 49,
      "sha256": "b6db53e997183ee97dd3f565ac0caea4d98f8f8d931c22ba91e0986700f760bc"
    },
    {
      "path": "node_modules/sherpa-onnx-win-x64/onnxruntime_providers_shared.dll",
      "bytes": 104960,
      "sha256": "551d0e1fe4c227d8542314ba718d52f4379e0c7bfe729a37c59833a884e27b4d"
    },
    {
      "path": "node_modules/sherpa-onnx-win-x64/onnxruntime.dll",
      "bytes": 17799168,
      "sha256": "7f66f939a881baf4f46a2216496798edf4a1429878b646d12674aa62f27d8a25"
    },
    {
      "path": "node_modules/sherpa-onnx-win-x64/package.json",
      "bytes": 1451,
      "sha256": "ad7d51b57cdc6c3ef402c3e6516939aa4960d4e96b2d32af2d008937d5f075d6"
    },
    {
      "path": "node_modules/sherpa-onnx-win-x64/README.md",
      "bytes": 97,
      "sha256": "33cc04186235622d194a4bfe157e50dfa5f99079ceed97d19ace4cb54067d2ed"
    },
    {
      "path": "node_modules/sherpa-onnx-win-x64/sherpa-onnx-c-api.dll",
      "bytes": 4294656,
      "sha256": "97dab91a51a9ae279ef6e18936fef652b5ecb881d63880de883a16f1a63d15cb"
    },
    {
      "path": "node_modules/sherpa-onnx-win-x64/sherpa-onnx-cxx-api.dll",
      "bytes": 264192,
      "sha256": "869d7c22ddc788f102f3d1850f738f31d31864e033640fddc8176b96bfac402b"
    },
    {
      "path": "node_modules/sherpa-onnx-win-x64/sherpa-onnx.node",
      "bytes": 697344,
      "sha256": "62fdf07d99ecb56054d868a7cf21f994c1cc729814dcdefcaf32eab34f8cb1f7"
    }
  ]
} as const;
