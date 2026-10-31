# H3 Audio Retake Studio

A local, browser-based audio and lip-sync repair studio for ComfyUI and MiniMax H3. Select a passage on a waveform, make or import speech takes, mark the speaker and mouth, compare a repair, and export the full video. The interface orchestrates ComfyUI jobs; you do not need to wire separate graphs for each operation.

> **Early experimental software.** Check the generated words, voice, face tracking, lip-sync, transitions and colors. The model may change a face or produce artifacts.

## Install

1. Install and start an up-to-date [ComfyUI](https://github.com/comfyanonymous/ComfyUI) with a working MiniMax H3 setup. This version is tested locally, with ComfyUI and the browser on the same machine.
2. Place this repository in `ComfyUI/custom_nodes/H3-AudioRetake-studio`. Install these ComfyUI node packs and their dependencies as directed by their authors:
   - [ComfyUI-H3-Motion-Context-MultiRef](https://github.com/seitanism/ComfyUI-H3-Motion-Context-MultiRef)
   - [ComfyUI-H3-FaceRefine](https://github.com/Carasibana/ComfyUI-H3-FaceRefine)
   - [ComfyUI-VideoHelperSuite](https://github.com/Kosinkadink/ComfyUI-VideoHelperSuite)
3. Install FFmpeg and FFprobe and make both available on the ComfyUI process PATH. Face tracking and optional export color matching also need OpenCV and NumPy in ComfyUI's Python environment; install FaceRefine's requirements there. The face detector may download its weights on first use.
4. Install compatible H3 Ref2VA, Qwen H3 text encoder, H3 video/audio VAEs and a **Pika H3 Flex Ref2VA** LoRA in their appropriate ComfyUI model folders. Open the studio's **H3 model setup** to choose the actual filenames. The app does not include or automatically download models. Check their separate terms before use.
5. Restart ComfyUI and open **http://127.0.0.1:8188/audio-retake/**. If ComfyUI uses a different port, use that port instead. A separate studio server is not required.

The Pika sampler node bundled here follows an experimental six-step ComfyUI schedule. It does not include the Pika weights or claim exact parity with Pika's original inference code. See [Pika H3 Flex](https://huggingface.co/Pika-Labs/Pika-H3-Flex) and its model license. ComfyUI, the other node packs, their dependencies and model weights are independent projects with their own licenses.

## Make a retake

1. Open your original video or audio and drag over a short interval on the waveform.
2. Enter the words and optionally a voice reference, then generate takes. The reference player lets you check the recording. You can edit the prompt directly. Alternatively, import a recording.
3. Listen and choose a take. Use **Take start** to skip unwanted leading silence. Audio-only export replaces the selected interval and adds the chosen short fades.
4. For lip-sync, open a video, choose the speaker on the first frame, track their face and review the colored tracking box. Draw an oval over the mouth and check it across the passage.
5. Adjust denoise strength, mouth mask softness and face color match. A low denoise may preserve more of the face but weaken lip-sync. The Pika six-step schedule rounds settings to whole steps. Scrub to a clear face frame and select it as the reference; the first tracked frame is the default.
6. Render, compare the original and repair, then export the full video. The selected supplied audio is locked during lip-sync and used in the export. The optional **Reduce full-frame color jumps** calibration compares repair frames to the source before export. It is experimental, adds processing time, and can fail or change the image on challenging footage; turn it off if it makes a result worse.

For dialogue, label non-overlapping waveform passages, open each turn and render its repair with its own take and speaker. **Export all completed turns** combines up to eight turns. Labels are manual; they do not identify or isolate voices. A completed lip repair can also download its ComfyUI **API-format workflow**. That JSON refers to model names and local input files; it does not package those assets or represent the earlier interactive choices.

## What is preserved

- The original files are never overwritten. Export re-encodes the full MP4, so untouched pixels and audio are not bit-identical.
- Replacing an audio interval replaces everything audible there, including other voices and ambient sound. Use separate stems or a careful external mix when needed.
- Face selection uses FaceRefine detection and tracking, with a manually drawn oval fixed to the crop. It is **not SAM 3.1**, independent lip tracking, or automatic diarization. Inspect the colored tracking preview for switches and missed frames.
- The model can alter the face, even with a face reference, and the replacement may not be perfectly synchronized. The color calibration cannot guarantee continuity.
- Each lip repair is a short single-shot passage (about seven seconds maximum) and requires enough source frames after the interval for H3 padding. Browser-supported codecs and the upload limit apply. Session state, selections and takes are lost on refresh; downloaded files and ComfyUI output files remain.
- The app makes separate ComfyUI jobs for audio, tracking and rendering because the user chooses and reviews results between steps. It is one interface, not one unattended monolithic ComfyUI graph.

## Local data and security

The interface and its export endpoints accept connections only from localhost. ComfyUI itself may have different network settings; this project does not change them. Uploaded source files, voice references, masks and intermediate clips are copied to ComfyUI's `input/AudioRepairStudio` and `output/AudioRepairStudio` folders. Full exports go to `output/AudioRepairStudio/exports`. Remove files you no longer need using your usual file manager. No media, models, tokens or personal demo files are included in this repository.

## Project status

This is an early community prototype, tested with a local Windows/NVIDIA setup. Other platforms, model variants, GPUs and unusual frame rates need more testing. LTX Dub-It is not part of this project. Contributions and issue reports with reproducible, shareable examples are welcome.

## License

The application source is available under the [MIT License](LICENSE), the same license used by Henge. ComfyUI, third-party nodes, Pika H3 Flex and all model weights have their own licenses and are not redistributed here.
