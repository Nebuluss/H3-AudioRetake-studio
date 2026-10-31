"""Audio Retake Studio: a local ComfyUI interface and Pika sampler."""
import asyncio
import ipaddress
import json
import math
import re
import subprocess
import tempfile
import uuid
from pathlib import Path

from aiohttp import web
import folder_paths
from server import PromptServer

ROOT = Path(__file__).resolve().parent
WEB = ROOT / "web"
ALLOWED_ASSETS = {"index.html", "app.js", "models.js", "lip.js", "turns.js", "style.css", "h3_audio_preset.json", "lip_preset.json"}
routes = PromptServer.instance.routes


def local_request(request, *, write=False):
    """The companion is intended for direct use on the ComfyUI host only."""
    try:
        if not ipaddress.ip_address(request.remote).is_loopback:
            return False
        host = request.host.rsplit(":", 1)[0].strip("[]").lower()
        if host not in ("localhost", "127.0.0.1", "::1"):
            return False
        if write and request.headers.get("Origin") != f"{request.scheme}://{request.host}":
            return False
        return True
    except (ValueError, AttributeError):
        return False


def require_local(request, *, write=False):
    if not local_request(request, write=write):
        raise web.HTTPForbidden(text="Audio Retake Studio is available on localhost only.")


@routes.get("/audio-retake/")
async def index(request):
    require_local(request)
    return web.FileResponse(WEB / "index.html")


@routes.get("/audio-retake/api/info")
async def info(request):
    require_local(request)
    return web.json_response({"comfy_input": folder_paths.get_input_directory(), "path_separator": __import__("os").sep})


@routes.get("/audio-retake/api/result/{name}")
async def result(request):
    require_local(request)
    name = request.match_info["name"]
    if not re.fullmatch(r"[0-9a-f]{32}\.mp4", name):
        raise web.HTTPNotFound()
    path = Path(folder_paths.get_output_directory()) / "AudioRepairStudio" / "exports" / name
    if not path.is_file():
        raise web.HTTPNotFound()
    return web.FileResponse(path, headers={"Content-Disposition": "attachment; filename=audio-retake.mp4"})


def safe_file(root, name):
    if not isinstance(name, str) or not re.fullmatch(r"[A-Za-z0-9_. -]+", name) or name in (".", ".."):
        raise ValueError("Invalid local filename.")
    root = Path(root).resolve()
    expected = (root / "AudioRepairStudio").resolve()
    path = (expected / name).resolve()
    if path.parent != expected or not path.is_file():
        raise ValueError("A required local media file is missing.")
    return path


def build_export(args):
    source = safe_file(folder_paths.get_input_directory(), args.get("source"))
    audio = safe_file(folder_paths.get_input_directory(), args.get("audio"))
    turns = args.get("turns")
    if turns is None:
        turns = [{"repair": args.get("repair"), "start": args.get("start"), "end": args.get("end"), "clipStart": args.get("clipStart")}]
    if not isinstance(turns, list) or not 1 <= len(turns) <= 8:
        raise ValueError("Choose between one and eight turns.")
    resolved = []
    for turn in turns:
        if not isinstance(turn, dict):
            raise ValueError("Invalid turn.")
        repair = safe_file(folder_paths.get_output_directory(), turn.get("repair"))
        start, end, clip_start = (float(turn[k]) for k in ("start", "end", "clipStart"))
        if not all(math.isfinite(x) for x in (start, end, clip_start)) or not 0 <= clip_start <= start < end <= 100000:
            raise ValueError("Invalid selected interval.")
        resolved.append((repair, start, end, clip_start))
    resolved.sort(key=lambda item: item[1])
    if any(a[2] > b[1] for a, b in zip(resolved, resolved[1:])):
        raise ValueError("Turn intervals cannot overlap.")
    flags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
    probe = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "json", str(source)], capture_output=True, text=True, timeout=30, check=True, creationflags=flags)
    stream = json.loads(probe.stdout)["streams"][0]
    w, h = int(stream["width"]), int(stream["height"])
    if not (16 <= w <= 16384 and 16 <= h <= 16384):
        raise ValueError("Unsupported video dimensions.")
    output = Path(folder_paths.get_output_directory()) / "AudioRepairStudio" / "exports"
    output.mkdir(parents=True, exist_ok=True)
    name = uuid.uuid4().hex + ".mp4"
    if not isinstance(args.get("matchColors", False), bool):
        raise ValueError("Invalid color matching setting.")
    try:
        with tempfile.TemporaryDirectory(prefix="audio-retake-") as tmp:
            if args.get("matchColors", False):
                from .colour_match import match_repair_color
                resolved = [(match_repair_color(source, repair, start, end, clip_start, tmp, i), start, end, clip_start)
                            for i, (repair, start, end, clip_start) in enumerate(resolved)]
            cmd = ["ffmpeg", "-v", "error", "-y", "-i", str(source)]
            for repair, _, _, _ in resolved:
                cmd += ["-i", str(repair)]
            cmd += ["-i", str(audio)]
            filters, previous = [], "0:v"
            for i, (_, start, end, clip_start) in enumerate(resolved):
                filters.append(f"[{i+1}:v]scale={w}:{h}:flags=lanczos,setpts=PTS-STARTPTS+{clip_start:.9f}/TB[repair{i}]")
                filters.append(f"[{previous}][repair{i}]overlay=0:0:eof_action=pass:repeatlast=0:enable=\'between(t,{start:.9f},{end:.9f})\'[stage{i}]")
                previous = f"stage{i}"
            cmd += ["-filter_complex", ";".join(filters), "-map", f"[{previous}]", "-map", f"{len(resolved)+1}:a:0", "-c:v", "libx264", "-preset", "fast", "-crf", "18", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", str(output / name)]
            proc = subprocess.run(cmd, capture_output=True, text=True, timeout=1200, creationflags=flags)
            if proc.returncode:
                raise RuntimeError("Video export failed: " + proc.stderr[-1200:])
    except Exception:
        (output / name).unlink(missing_ok=True)
        raise
    return "/audio-retake/api/result/" + name


@routes.post("/audio-retake/api/export")
@routes.post("/audio-retake/api/export-turns")
async def export(request):
    require_local(request, write=True)
    try:
        if request.content_type != "application/json" or (request.content_length or 0) > 10000:
            raise ValueError("Invalid export request.")
        args = await request.json()
        if not isinstance(args, dict):
            raise ValueError("Invalid export request.")
        url = await asyncio.to_thread(build_export, args)
        return web.json_response({"url": url})
    except (ValueError, KeyError, TypeError, FileNotFoundError, RuntimeError, subprocess.SubprocessError) as exc:
        return web.json_response({"error": str(exc)}, status=400)


@routes.get("/audio-retake/{name}")
async def asset(request):
    require_local(request)
    name = request.match_info["name"]
    if name not in ALLOWED_ASSETS:
        raise web.HTTPNotFound()
    return web.FileResponse(WEB / name)


class AudioRetakePikaSampler:
    """Six-step experimental Pika H3 Flex sampling recipe."""
    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {"model": ("MODEL",)}}

    RETURN_TYPES = ("MODEL", "SAMPLER", "SIGMAS")
    RETURN_NAMES = ("model", "sampler", "sigmas")
    FUNCTION = "configure"
    CATEGORY = "Audio Retake Studio"

    def configure(self, model):
        import torch
        import comfy.model_sampling
        import comfy.samplers
        if model.model.__class__.__name__ != "MiniMaxH3":
            raise ValueError("The Audio Retake Pika sampler requires a MiniMax H3 model.")
        patched = model.clone()
        class Sampling(comfy.model_sampling.ModelSamplingAV, comfy.model_sampling.CONST):
            pass
        original = patched.get_model_object("model_sampling")
        sampling = Sampling(patched.model.model_config)
        sampling.set_parameters(shift=12.0, audio_shift=3.0)
        if hasattr(original, "noise_scale"):
            sampling.set_noise_scale(original.noise_scale)
        patched.add_object_patch("model_sampling", sampling)
        options = patched.model_options["transformer_options"] = patched.model_options.get("transformer_options", {}).copy()
        options["minimax_h3_sigma_shift_video"] = 12.0
        options["minimax_h3_sigma_shift_audio"] = 3.0
        knots = torch.tensor([1.0, .75, .5, .25, .1, .04, 0.0], dtype=torch.float32)
        sigmas = 12.0 * knots / (1.0 + 11.0 * knots)
        return (patched, comfy.samplers.sampler_object("lcm"), sigmas)


NODE_CLASS_MAPPINGS = {"AudioRetakePikaSampler": AudioRetakePikaSampler}
NODE_DISPLAY_NAME_MAPPINGS = {"AudioRetakePikaSampler": "Audio Retake - Pika H3 Flex (experimental)"}
