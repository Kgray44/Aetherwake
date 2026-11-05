# Local “Hey Vela” evaluation checkpoint — 2026-11-04

**No acoustic candidate is accepted or promoted.** The required pronunciation is
“Hey VAY-luh” (/ˈveɪlə/). The isolated local-engine adapter and pinned artifact
verification are implemented, but the measured recognition results do not yet
qualify an always-listening product feature. Research paused for canonical Folder
sources, then resumed with the bounded Whisper comparisons below. This document
does not close Addendum B acceptance.

All speech experiments used owned synthetic Windows voices and controlled PCM or
WAV input. There was no physical microphone/default-device capture, cloud wake or
transcription request, paid call, OS permission change, or training on user audio.
These fixtures do not establish human pronunciation, real-room false accepts per
hour, far-field performance, or gaming performance. Private fixtures and receipts
are retained outside the public repository; no audio, transcripts, or private
machine paths are published here; short synthetic fixture labels identify confusers.

## Measured acoustic results

Counts below refer to their stated fixture sets, not independent population
estimates. Different sets and operating points must not be compared as a single
benchmark ranking.

| Local path | Observed result | Decision |
| --- | --- | --- |
| Sherpa-ONNX keyword spotting | Fourteen int8/fp32/model/decoder variants, including active-path limits 8/16. Best recall operating points detected 20/24 positives while accepting 7–8/20 negatives. | Phrase customization is real; this pronunciation/confuser result fails. |
| Windows System.Speech/SAPI SRGS | Installed English-US desktop recognizer; explicit VAY-luh phones and competing keyword/dictation grammar. Best tested operating point: 3/24 positives, 0/20 negatives. | Existing host support works with controlled streams, but recall fails. |
| PocketSphinx 5.0.4 | Exact phoneme dictionary/keyword path: 23/24 positives, 5/20 false accepts. Competing-phrase verifier: 16/24 positives, 0/20 false accepts. | Neither tested operating point meets the target. |
| Vosk 0.3.45 + small-en-us-0.15 | Grammar words were verified in the actual model lexicon before audio evaluation. Canonical VEIL alias detected 0/6 initial positives and 1/24 legacy positives; literal “veil a” encoding controls detected 2/8. | Dictionary membership and spelling aliases do not establish acoustic support. |
| Original Google embedding + small custom classifier | Corrected-timing, 3,097-parameter candidate: validation 11/12 positives, 0/72 false accepts. Frozen heldout test: 47/48 positives, **5/240 false accepts**. | Failed and unpromoted; the opened heldout set is frozen and must not be used for retuning. |
| whisper.cpp 1.9.0 + original tiny.en | Initial six clips: 2/2 positives, 0/4 negatives. On 44 development clips, context 200 detected 12/24 positives, full context/beam 21/24, and full context/greedy 21/24; each accepted 0/20 negatives. | All fail the frozen minimum 23/24-positive, zero-false-accept development gate. Fresh blind remains unread; no streaming, idle/gaming, or boundary acceptance. |
| PocketSphinx HEY gate → fixed-window tiny.en | One continuous 44-clip stream with uniform four-second silence gaps, no decoder resets, fixed 160 ms pre-HEY / two seconds post-HEY-end window and three-second debounce: 14/24 positives, 0/20 false accepts. | Failed. The gate saw every positive, but cropped verification reduced recall. No blind evaluation or promotion. |

The custom classifier heldout set contained 72 base clips with four correlated
derivatives each. Its five false accepts came from two base confusers: “the veil
around the lamp” and “Hey Viola.” An additional legacy-domain check detected only
3/24 positives, and an initial-domain check detected 5/6. The mismatch remains
unexplained. No pronunciation label was declared wrong merely because an ASR
engine transcribed it differently. “Hey Villa,” “Hey Bella,” “Hey Stella,” and
similar names remain negatives, not aliases added to hide recognition failures.

## CPU and memory observations

Measurements were Windows x64 CPU process observations on this host, with no GPU
qualification. “One-core percent” means process CPU time divided by wall time;
it is not whole-host CPU utilization. Measurements from different processes and
input pacing are not directly comparable.

| Conditions | Observed process cost |
| --- | --- |
| Sherpa, ten seconds of paced zero PCM | 2.653% of one core; 119,087,104-byte RSS; p95 chunk processing 5.18 ms. This is an idle-like synthetic probe. |
| SAPI, 181.13 seconds of fixture audio | 6.58 CPU seconds; approximately 197 MB peak PowerShell process RSS. |
| Vosk, 218.87 seconds of fixture audio processed faster than real time | 4.19 CPU seconds; approximately 1.9% one-core real-time factor; 249 ms model load; approximately 144.8 MB peak RSS. |
| Corrected custom-classifier training trial | 47.0 s wall / 44.9 s CPU, including 40.5 s feature extraction; approximately 400 MB peak RSS. This is training cost, not idle detector cost. |
| tiny.en, one CPU thread, no GPU, no fallback, six development clips | Full context approximately 1.03–1.19 CPU seconds per clip and 198.9 MB peak RSS. Shortened supported context: the two positives used 0.313/0.328 CPU seconds; some negative clips took 1.59/2.0 CPU seconds and peak RSS reached approximately 176.3 MB. |
| tiny.en, corrected stdin transport, 44 development clips / 181.13 s audio | Context 200: 30.00 s wall / 28.06 s CPU, sampled peak 176,058,368 bytes. Full-context beam: 44.29 s / 42.14 s, 199,176,192 bytes, p50/p95 per clip 994/1,157 ms. Full-context greedy: 39.86 s / 37.94 s, 170,483,712 bytes. |
| HEY gate → tiny.en stream trial, 357.13 s input including fixed gaps | 52.61 s wall; gate 5.59 s CPU plus verifier 44.38 s CPU; 237 gate events / 53 bounded verifier calls; sampled combined parent/child working set 233,132,032 bytes. Verifier p50/p95 864/957 ms; all 53 child closures acknowledged. Faster-than-real-time, synthetic workload, not idle/gaming proof. |

The original stdin trial produced empty stdout because the upstream CLI treats
input `-` as the default output basename and disables its result callback. It is
retained as a transport failure, not a 0/24 acoustic result. An inert `-of` basename
with **no output-format flags** restores the callback without opening output files;
file-versus-stdin parity was then proved on a positive and a confuser. The corrected
trials sent bounded WAV bytes through stdin, used sanitized child environments,
and bounded stdout, stderr, execution time, and process teardown. This behavior is
defined by the [pinned upstream CLI implementation](https://github.com/ggml-org/whisper.cpp/blob/v1.9.0/examples/cli/cli.cpp).

The HEY gate's online 100 fps frame clock was checked independently of synthetic
bookmarks: prepending exactly 32,000 zero PCM samples shifted both detected start
and end by exactly 32,000 samples on two controls. It produced no event on silence
but many events on tones. This proves that tested sample-clock relationship, not
a final Vela keyword-end boundary or acceptable gate precision. The failed
two-stage path remains a private evaluation, with no production adapter promotion.
It still needs a useful new candidate, untouched evaluation, idle/gaming evidence,
and a truthful final keyword-end boundary before command trimming is accepted.

## Original Google conversion validation

Only the original Google Apache-licensed checkpoint was used; ambiguous derived
openWakeWord embedding files were not substituted. All 96 checkpoint tensors were
read with checksum validation. Conversion mapped every reachable inference
operation and failed on unsupported operations. The frontend used 16 kHz float PCM,
400-sample periodic Hann windows, 160-sample hop, 512-point magnitude FFT, 32 HTK
mel bands from 60–3,800 Hz, and log(mel + 0.001), matching the original graph input
path.

A reference-only official TensorFlow C 2.15 CPU DLL ran the original SavedModel
graph and frontend. Across 27 probes, representative speech frontend maximum
absolute difference was 6.35e-6; end-to-end embedding difference was 5.34e-5.
A cancellation-sensitive 440 Hz sine probe retained a larger frontend difference
of 8.91e-4 and end-to-end difference of 0.00217. This supports the tested numerical
comparison, not a universal exact-equivalence claim or recognition-quality claim.

Initial synthetic bookmark times were proved early relative to actual PCM speech
activity. Earlier timing-dependent classifier results were invalidated for quality
claims and retained. Corrected PCM activity-aligned minimal pairs showed varying
features rather than total collapse: mean within-pair cosine distance was 0.08791,
versus 0.15562 for same-word comparisons across voices. This does not establish
reliable VAY-luh versus VEE-luh discrimination in real speech.

No Python, TensorFlow, NumPy, or ONNX Runtime experiment installation is a proposed
end-user application prerequisite. The classifier candidate was never connected
to the production wake port.

## Provenance and license boundaries

| Asset/runtime | Recorded provenance and deployment constraint |
| --- | --- |
| Sherpa | Node runtime 2.0.1 and the selected official Gigaspeech keyword model were inspected separately; model Apache-2.0, ONNX Runtime MIT and notices retained. Standalone pinned bundle: 29,062,648 bytes. It must be packaged explicitly, not resolved from a developer npm cache at application startup. |
| SAPI | System.Speech uses the installed Windows desktop recognizer and host Windows license. It is a Windows host capability, not a redistributable model bundle or cross-platform Electron engine. Only controlled audio-stream input was used. |
| PocketSphinx | Official Windows wheel and its bundled model notices were inspected separately. No assumption that a core-code license automatically covers arbitrary model assets was made. |
| Vosk | Official small-en-us-0.15 model table identifies Apache-2.0. The Windows runtime also contains GNU runtime DLLs; complete matched-source/notices work remains unresolved. The entire runtime bundle cannot be described as Apache-only. |
| Google original embedding | Original speech-embedding version 1 archive: SHA256 `0f626c42009c1eb916401b7b2800229a211e43100115bc591b9afbf1b60da27f`. Converted ONNX: SHA256 `53df9903cffbf07135be7ea5c98612727100d146d9765ada4716512be2b69636`. Original license/source and conversion records retained separately. |
| tiny.en | Original OpenAI Whisper code and weights are MIT-licensed; whisper.cpp MIT notices retained. Model revision `5359861c739e955e79d9a303bcbc70fb988958b1`, 77,704,715 bytes, publisher LFS SHA256 `921e4cf8686fdd993dcd081a5da5b6c365bfde1162e72b08d75ac75289920b1f`. Official Windows CPU release archive 1.9.0 SHA256 `00c4304b6be363a224a4b69829df49009f74131df8c3ce6a5878b89a11cd26ef`. |
| openWakeWord | Apache core code does not resolve the separately reported derived-feature-asset license uncertainty. Pretrained keyword classifier license restrictions also differ from core code. No ambiguous derived asset was promoted. |
| Porcupine | Official Node workflow requires a Picovoice AccessKey and custom platform keyword artifact. No account/key, activation behavior, entitlement, or redistribution terms were qualified here. It is not a verified keyless dependency. |

Primary sources used in the investigation:

- [Sherpa Node support](https://k2-fsa.github.io/sherpa/onnx/javascript-api/install.html), [custom keyword spotting](https://k2-fsa.github.io/sherpa/onnx/kws/index.html), [official models](https://k2-fsa.github.io/sherpa/onnx/kws/pretrained_models/index.html), and [model license clarification](https://github.com/k2-fsa/sherpa-onnx/issues/3802).
- [Microsoft controlled audio-stream input](https://learn.microsoft.com/en-us/dotnet/api/system.speech.recognition.speechrecognitionengine.setinputtoaudiostream?view=netframework-4.8.1), [SRGS pronunciation](https://learn.microsoft.com/en-us/dotnet/api/system.speech.recognition.srgsgrammar.srgstoken.pronunciation?view=netframework-4.8.1), and [confidence semantics](https://learn.microsoft.com/en-us/dotnet/api/system.speech.recognition.recognizedphrase.confidence?view=netframework-4.8.1).
- [PocketSphinx configuration](https://pocketsphinx.readthedocs.io/en/stable/config_params.html), [Vosk model/license table](https://alphacephei.com/vosk/models), [Vosk grammar adaptation](https://alphacephei.com/vosk/adaptation), and [GNU runtime license exception](https://gcc.gnu.org/onlinedocs/libstdc++/manual/license.html).
- [Original Google embedding](https://www.kaggle.com/models/google/speech-embedding), [Google research license](https://github.com/google-research/google-research/blob/master/LICENSE), [openWakeWord asset/license description](https://github.com/dscripka/openWakeWord), and [derived embedding issue](https://github.com/dscripka/openWakeWord/issues/338).
- [Original OpenAI Whisper license and weights](https://github.com/openai/whisper), [whisper.cpp supported CPU path](https://github.com/ggml-org/whisper.cpp), and [Porcupine Node requirements](https://picovoice.ai/docs/quick-start/porcupine-nodejs/).

## Implemented source boundary

The existing local engine port runs real Sherpa NAPI inference in a hidden isolated
child, verifies exact artifact paths/hashes, strips provider/private IPC and Node
injection environment variables, bounds buffers/IPC/diagnostics/timeouts, and waits
for child termination during cleanup. Its detector timestamps are explicitly
Sherpa token-frame estimates at 40 ms resolution. A future verifier must not reuse
that provenance label without producing that boundary.

Source SHA256 at this checkpoint:

| File under `prototypes/integrated-backend/src/` | SHA256 |
| --- | --- |
| `wake-engine.mts` | `3cb1417edc9808309c74173a6475fbe6472b1da000b34a06d65d7db3531df8f5` |
| `wake-engine-worker.mts` | `ff9042a389f65763eab76e430c151e25e9ab057dfcba05ead7120e81669f1a0f` |
| `wake-engine-artifacts.mts` | `1b39ddbd2f6aedf9133e00f3a47e15d46a214aaf25478a0962d691c3b8fa1848` |
| `wake-engine-artifact-registry.mts` | `6cdacdaa4158d2858802f078e16bd1e2fa62a3c9288918eae758b0343ef67669` |

Source plumbing and synthetic lifecycle tests are distinct from acoustic product
acceptance. Wake stays off by default, and these experiments authorize no ambient
capture, automatic paid session, or promotion of a failed acoustic candidate.
