"""Local Whisper transcription with word timings for the studio."""
from pathlib import Path

TARGET_RATE = 16000
CHUNK_SECONDS = 28


def find_model(root):
    """Return the first Hugging Face Whisper folder under models/whisper."""
    base = Path(root) / "whisper"
    folders = sorted(p for p in base.iterdir() if (p / "config.json").is_file()) if base.is_dir() else []
    if not folders:
        raise ValueError("No Whisper model folder was found under models/whisper.")
    return folders[0]


def chunk_edges(mono):
    """Split at the quietest point before each 28 second limit, so words stay whole."""
    import torch
    edges, start, limit, window = [0], 0, CHUNK_SECONDS * TARGET_RATE, TARGET_RATE // 50
    while len(mono) - start > limit:
        from_sample, to_sample = start + limit - 8 * TARGET_RATE, start + limit
        energy = mono[from_sample:to_sample].unfold(0, window, window).pow(2).sum(1)
        start = from_sample + int(torch.argmin(energy)) * window
        edges.append(start)
    return edges + [len(mono)]


def speech_spans(mono):
    """Find spoken phrases. Whisper's timings drift across long silences, so each phrase runs alone."""
    window = TARGET_RATE // 100
    frames = mono[:len(mono) // window * window].reshape(-1, window).pow(2).mean(1).sqrt()
    if not len(frames):
        return []
    voiced = (frames > float(frames.quantile(.95)) * .15).nonzero().flatten().tolist()
    spans = []
    for frame in voiced:
        if spans and frame - spans[-1][1] <= 30:
            spans[-1][1] = frame
        else:
            spans.append([frame, frame])
    return [(max(0, a - 12) * window, min(len(frames), b + 13) * window) for a, b in spans]


def repair_times(words, first, last):
    """Token timings can run into Whisper's padding. Spread such words across the gap by length."""
    index = 0
    while index < len(words):
        word = words[index]
        previous = words[index - 1]["end"] if index else first
        if first - .2 <= word["start"] <= word["end"] <= last + .2 and word["start"] >= previous - .05:
            index += 1
            continue
        stop = index
        while stop < len(words) and not (previous <= words[stop]["start"] <= last and stop > index):
            stop += 1
        limit = words[stop]["start"] if stop < len(words) else last
        run = words[index:stop]
        total = sum(len(w["word"]) for w in run) or 1
        position = max(previous, first)
        for item in run:
            span = max(0.0, limit - position) * len(item["word"]) / total if item is not run[-1] else max(0.0, limit - position)
            item["start"], item["end"] = round(position, 3), round(position + span, 3)
            position += span
            total -= len(item["word"])
        index = stop
    return words


def group_words(tokenizer, ids, times, offset):
    """Join Whisper tokens into words. A new word starts on a token with a leading space."""
    words = []
    for index, token in enumerate(ids):
        if token >= tokenizer.all_special_ids[0] or token in tokenizer.all_special_ids:
            continue
        text = tokenizer.decode([token])
        start, end = float(times[index]) + offset, float(times[index + 1]) + offset
        if text.startswith(" ") or not words:
            words.append({"ids": [token], "start": start, "end": end})
        else:
            words[-1]["ids"].append(token)
            words[-1]["end"] = end
    return [{"word": tokenizer.decode(w["ids"]).strip(), "start": round(w["start"], 3), "end": round(w["end"], 3)} for w in words]


def tighten(words, mono):
    """Whisper stretches a word across the pause that follows it; fit it to the speech energy."""
    window = TARGET_RATE // 100
    frames = mono[:len(mono) // window * window].reshape(-1, window).pow(2).mean(1).sqrt()
    if not len(frames):
        return words
    threshold = float(frames.quantile(.95)) * .1
    for word in words:
        first, last = int(word["start"] * 100), min(len(frames), max(int(word["end"] * 100), int(word["start"] * 100) + 1))
        voiced = (frames[first:last] > threshold).nonzero().flatten().tolist()
        if voiced:
            word["start"], word["end"] = round((first + voiced[0]) / 100, 3), round((first + voiced[-1] + 1) / 100, 3)
    return words


def transcribe_words(waveform, sample_rate, model_path, language="", device="cpu", dtype=None):
    import torch
    import torchaudio
    from transformers import WhisperForConditionalGeneration, WhisperProcessor
    mono = waveform[0].mean(0).float().cpu()
    if sample_rate != TARGET_RATE:
        mono = torchaudio.functional.resample(mono, sample_rate, TARGET_RATE)
    dtype = dtype or torch.float32
    processor = WhisperProcessor.from_pretrained(model_path)
    model = WhisperForConditionalGeneration.from_pretrained(model_path, torch_dtype=dtype).to(device)
    words = []
    try:
        for first, last in speech_spans(mono):
            phrase = mono[first:last]
            edges = chunk_edges(phrase)
            for start, end in zip(edges, edges[1:]):
                features = processor(phrase[start:end].numpy(), sampling_rate=TARGET_RATE, return_tensors="pt").input_features.to(device, dtype)
                with torch.inference_mode():
                    out = model.generate(features, language=language or None, task="transcribe", return_token_timestamps=True)
                ids, times = out["sequences"][0].tolist(), out["token_timestamps"][0].tolist()
                words += repair_times(group_words(processor.tokenizer, ids, times + [times[-1]], (first + start) / TARGET_RATE), (first + start) / TARGET_RATE, (first + end) / TARGET_RATE)
    finally:
        del model
    return [word for word in tighten(words, mono) if word["end"] - word["start"] >= .03]
