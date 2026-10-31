# H3 Audio Retake Studio

A local, browser-based audio and lip-sync repair studio for ComfyUI and MiniMax H3. Select a passage on a waveform, make or import speech takes, mark the speaker and mouth, compare a repair, and export the full video. The interface orchestrates ComfyUI jobs; you do not need to wire separate graphs for each operation.

> **Early experimental software.** Check the generated words, voice, face tracking, lip-sync, transitions and colors. The model may change a face or produce artifacts.

## Demo

[Watch the narrated studio presentation](https://github.com/Nebuluss/H3-AudioRetake-studio/raw/refs/heads/main/demo/H3_Audio_Retake_Studio_presentation_narrated.mp4) (2½ minutes). It walks through the interface, retake modes and example results.

[Watch the studio walkthrough and edited cyclops scene](https://github.com/Nebuluss/H3-AudioRetake-studio/raw/refs/heads/main/demo/studio-walkthrough.mp4). The walkthrough shows actual interface captures followed by a generated dialogue edit. The longer final passage in this example was rendered with a custom ComfyUI workflow and assembled in Tesseract; the studio currently limits individual lip repairs to about seven seconds.

## AI coding agents

[AGENTS.md](AGENTS.md) explains the current workflow, limitations, troubleshooting, research and safe testing for coding agents. Claude can also discover [CLAUDE.md](CLAUDE.md).

## Install

1. Install and start an up-to-date [ComfyUI](https://github.com/comfyanonymous/ComfyUI) with a working MiniMax H3 setup. This version is tested locally, with ComfyUI and the browser on the same machine.
2. Clone [this repository](https://github.com/Nebuluss/H3-AudioRetake-studio) into `ComfyUI/custom_nodes`:

   ```bash
   cd ComfyUI/custom_nodes
   git clone https://github.com/Nebuluss/H3-AudioRetake-studio.git
   ```

   Install these ComfyUI node packs and their dependencies as directed by their authors:
   - [ComfyUI-H3-Motion-Context-MultiRef](https://github.com/seitanism/ComfyUI-H3-Motion-Context-MultiRef)
   - [ComfyUI-H3-FaceRefine](https://github.com/Carasibana/ComfyUI-H3-FaceRefine)
   - [ComfyUI-VideoHelperSuite](https://github.com/Kosinkadink/ComfyUI-VideoHelperSuite)
3. Install FFmpeg and FFprobe and make both available on the ComfyUI process PATH. Face tracking and optional export color matching also need OpenCV and NumPy in ComfyUI's Python environment; install FaceRefine's requirements there. The face detector may download its weights on first use.
4. Install compatible H3 Ref2VA, Qwen H3 text encoder, H3 video/audio VAEs and a **Pika H3 Flex Ref2VA** LoRA in their appropriate ComfyUI model folders. Open the studio's **H3 model setup** to choose the actual filenames. The app does not include or automatically download models. Check their separate terms before use.
5. Restart ComfyUI and open **http://127.0.0.1:8188/audio-retake/**. If ComfyUI uses a different port, use that port instead. A separate studio server is not required.

The Pika sampler node bundled here follows an experimental six-step ComfyUI schedule. It does not include the Pika weights or claim exact parity with Pika's original inference code. See [Pika H3 Flex](https://huggingface.co/Pika-Labs/Pika-H3-Flex) and its model license. ComfyUI, the other node packs, their dependencies and model weights are independent projects with their own licenses.

## Make a retake

1. Open your original video or audio and drag over a short interval on the waveform. Drag a selection edge to adjust it, zoom up to 32×, type IN and OUT to the millisecond, nudge them by 1 ms, 10 ms, one frame or 100 ms, or use **Snap edges to pauses**.
2. Enter the words and optionally a voice reference, then generate takes. **Acting preset** fills the acting direction, with an intensity setting; edit the text freely or save your own presets in this browser. Presets are prompt guidance, not measured controls: in tests they changed Generate takes clearly, Free acting modestly, and a normal joint retake barely, because the voice reference and surrounding speech dominate. Generated takes follow the estimated line length, because H3 fills spare time with invented speech when a voice reference is used. The reference player lets you check the recording. You can edit the prompt directly. Alternatively, import a recording.
3. Listen and choose a take. Use **Take start** to skip unwanted leading silence. Audio-only export replaces the selected interval and adds the chosen short fades; a take shorter than the interval leaves silence after it.
4. For lip-sync, open a video, choose the speaker on the first frame, track their face and review the colored tracking box. Draw an oval over the mouth and check it across the passage.
5. Adjust denoise strength, mouth mask softness and face color match. A low denoise may preserve more of the face but weaken lip-sync. The Pika six-step schedule rounds settings to whole steps. Scrub to a clear face frame and select it as the reference; the first tracked frame is the default. A thumbnail shows the selected image here and on each dialogue turn.
6. Render, compare the original and repair, then export the full video. The selected supplied audio is locked during lip-sync and used in the export. The optional **Reduce full-frame color jumps** calibration compares repair frames to the source before export. It is experimental, adds processing time, and can fail or change the image on challenging footage; turn it off if it makes a result worse.

### Voice only and off-screen voice (experimental)

**Voice only** repairs speech and keeps the source picture. Export attempts to copy the video stream; if that fails, it falls back to re-encoding. Enter the words, select the passage and render; tracking the face is optional and gives H3 a closer view of the lips. **Off-screen voice** does the same for a speaker outside the frame. **Match level to nearby speech** adjusts the retake by up to 6 dB, and **Free acting** hides the surrounding speech from H3 so the acting direction has more effect. **Variations** renders several seeds and ranks them by how many expected words local Whisper hears. Leave **Keep the original ambience** off when the noise is the defect, because the separated background would bring it back. **Transcribe** uses PyTorch, torchaudio, Transformers and a local Hugging Face-format Whisper model folder under `models/whisper` to build a clickable word list; click a word to select it and shift-click to extend. The current project is saved in this browser and can be restored from the header; clearing site data removes it.

### Joint retake (experimental)

Choose **Joint retake** under Repair mode to replace or add speech inside the shot. H3 regenerates the voice and the mouth in one pass, while the real picture and sound around the interval stay in the latent as context. Select only the words to replace, enter them under **Words to speak**, then track the speaker and draw the mouth mask. A window of at least 124 frames is built around the selection, so the source needs about 5.2 seconds of video. This mode needs a restart of ComfyUI after installation or update for the **Audio Retake - Timed AV Mask** node. The audio mix keeps the source outside the retake before export; the final MP4 is encoded and is not guaranteed to be bit-identical. **Face direction** adds a visible reaction after the line; it can only show inside the mask. **Edge fade** sets how far the regeneration extends beyond the selection; shorten it between close words. Audio edges resolve to about 25 ms and video edges to about 170 ms. Keep the new line close to the original length: a static mask does not stop the mouth if the line ends early inside the interval.

For dialogue, or several separate areas of one clip, add each waveform passage as a turn, up to eight without overlap. Give passages the same speaker label to reuse the voice and acting. **Render all turns** renders whatever is missing in time order; a turn that is not ready is reported and the others still run. Passages can sit close together: when the fades cross, the row says so, and each picture repair stops halfway between the two lines, so check that join. **Export all completed turns** combines them. Labels are manual; they do not identify or isolate voices. A completed lip repair can also download its ComfyUI **API-format workflow**. That JSON refers to model names and local input files; it does not package those assets or represent the earlier interactive choices.

## What is preserved

- The original files are never overwritten. Export re-encodes the full MP4, so untouched pixels and audio are not bit-identical.
- Replacing an audio interval replaces everything audible there, including other voices and ambient sound. Use separate stems or a careful external mix when needed.
- Face selection uses FaceRefine detection and tracking, with a manually drawn oval fixed to the crop. It is **not SAM 3.1**, independent lip tracking, or automatic diarization. Inspect the colored tracking preview for switches and missed frames.
- The model can alter the face, even with a face reference, and the replacement may not be perfectly synchronized. The color calibration cannot guarantee continuity.
- Each lip repair is a short single-shot passage (about seven seconds maximum) and requires enough source frames after the interval for H3 padding. Browser-supported codecs and the upload limit apply. A project with takes or turns can be saved in this browser and restored from the header; browser storage limits and clearing site data can remove it. Opening a file alone does not replace the saved project. Downloaded files and ComfyUI output files remain separately.
- The app makes separate ComfyUI jobs for audio, tracking and rendering because the user chooses and reviews results between steps. It is one interface, not one unattended monolithic ComfyUI graph.

## Local data and security

The interface and its export endpoints accept connections only from localhost. ComfyUI itself may have different network settings; this project does not change them. Uploaded source files, voice references, masks and intermediate clips are copied to ComfyUI's `input/AudioRepairStudio` and `output/AudioRepairStudio` folders. Full exports go to `output/AudioRepairStudio/exports`. Remove files you no longer need using your usual file manager. The repository includes the public demonstration video; it does not include voice-reference files, model weights or tokens.

## Project status

This is an early community prototype, tested with a local Windows/NVIDIA setup. Other platforms, model variants, GPUs and unusual frame rates need more testing. LTX Dub-It is not part of this project. Contributions and issue reports with reproducible, shareable examples are welcome.

## License

The application source is available under the [MIT License](LICENSE), the same license used by Henge. ComfyUI, third-party nodes, Pika H3 Flex and all model weights have their own licenses and are not redistributed here.
