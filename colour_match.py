"""Experimental full-frame color calibration for a repaired passage.

Uses matching source and repair frames, ignoring the largest differences. This
cannot guarantee a seamless result, especially across cuts or rapid lighting.
"""
import subprocess
from pathlib import Path


def _read(cap, frame):
    import cv2
    cap.set(cv2.CAP_PROP_POS_FRAMES, frame)
    ok, image = cap.read()
    if not ok:
        raise ValueError("Could not read matching frames for color calibration.")
    return image


def _fit(xs, ys):
    import numpy as np
    x, y = np.concatenate(xs), np.concatenate(ys)
    if len(x) < 200:
        raise ValueError("Not enough usable image detail for color matching.")
    matrix = np.linalg.lstsq(x, y, rcond=None)[0]
    residual = np.max(np.abs(x @ matrix - y), axis=1)
    keep = residual <= max(6.0, float(np.quantile(residual, .9)))
    if keep.sum() > 100:
        matrix = np.linalg.lstsq(x[keep], y[keep], rcond=None)[0]
    if not np.isfinite(matrix).all() or np.max(np.abs(matrix[:3])) > 4 or np.max(np.abs(matrix[3])) > 100 or not .1 < abs(np.linalg.det(matrix[:3])) < 8:
        raise ValueError("Could not estimate a reliable color match for this passage.")
    return matrix.T.astype(np.float32)


def _sample(a, b):
    import numpy as np
    # Cap calibration work and include all parts of the frame. The robust fit
    # filters out the changed mouth and codec outliers.
    step = max(4, min(a.shape[:2]) // 80)
    x = a[::step, ::step].reshape(-1, 3).astype(np.float32)
    y = b[::step, ::step].reshape(-1, 3).astype(np.float32)
    valid = (x.min(axis=1) > 4) & (x.max(axis=1) < 250) & (y.min(axis=1) > 4) & (y.max(axis=1) < 250)
    return np.column_stack((x[valid], np.ones(valid.sum(), dtype=np.float32))), y[valid]


def _encode(source, destination, matrix, second=None):
    import cv2
    cap = cv2.VideoCapture(str(source))
    if not cap.isOpened():
        raise ValueError("Could not open the repair for color calibration.")
    width, height = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)), int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    fps = cap.get(cv2.CAP_PROP_FPS)
    if width < 16 or height < 16 or not (1 <= fps <= 120):
        raise ValueError("Unsupported repair video for color calibration.")
    cmd = ["ffmpeg", "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "bgr24", "-s", f"{width}x{height}", "-r", str(fps), "-i", "pipe:0", "-an", "-c:v", "libx264", "-preset", "veryfast", "-crf", "12", "-pix_fmt", "yuv420p", str(destination)]
    flags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
    proc = subprocess.Popen(cmd, stdin=subprocess.PIPE, stderr=subprocess.DEVNULL, creationflags=flags)
    try:
        while True:
            ok, frame = cap.read()
            if not ok:
                break
            frame = cv2.transform(frame, matrix)
            if second is not None:
                frame = cv2.transform(frame, second)
            proc.stdin.write(frame.tobytes())
        proc.stdin.close()
        if proc.wait(timeout=1200) != 0:
            raise RuntimeError("Color calibration encoding failed.")
    except Exception:
        proc.kill()
        proc.wait()
        raise
    finally:
        cap.release()


def match_repair_color(source, repair, start, end, clip_start, directory, index):
    try:
        import cv2
        import numpy as np
    except ImportError as exc:
        raise ValueError("Whole-frame color matching needs OpenCV and NumPy in the ComfyUI environment.") from exc
    original, edited = cv2.VideoCapture(str(source)), cv2.VideoCapture(str(repair))
    if not original.isOpened() or not edited.isOpened():
        raise ValueError("Could not open video for color calibration.")
    source_fps, repair_fps = original.get(cv2.CAP_PROP_FPS), edited.get(cv2.CAP_PROP_FPS)
    if not (1 <= source_fps <= 120 and 1 <= repair_fps <= 120):
        raise ValueError("Unsupported video frame rate for color calibration.")
    frame_count = int(edited.get(cv2.CAP_PROP_FRAME_COUNT))
    length = end - start
    offsets = [start - clip_start + length * fraction for fraction in (.05,.2,.4,.6,.8,.95)]
    indices = sorted({max(0, min(frame_count-1, round(offset * repair_fps))) for offset in offsets})
    if not indices:
        raise ValueError("No frames available for color calibration.")
    xs, ys = [], []
    for k in indices:
        r = _read(edited,k)
        o = _read(original,round((clip_start + k / repair_fps) * source_fps))
        if o.shape[:2] != r.shape[:2]:
            o = cv2.resize(o, (r.shape[1],r.shape[0]), interpolation=cv2.INTER_AREA)
        x,y = _sample(r,o); xs.append(x); ys.append(y)
    matrix = _fit(xs,ys)
    first = Path(directory) / f"color-first-{index}.mp4"
    final = Path(directory) / f"color-final-{index}.mp4"
    original.release(); edited.release()
    _encode(repair,first,matrix)
    # Account for the color conversion of the intermediate encoder itself.
    edited, encoded = cv2.VideoCapture(str(repair)), cv2.VideoCapture(str(first))
    xs,ys=[],[]
    for k in indices:
        raw, dec = _read(edited,k), _read(encoded,k)
        target = cv2.transform(raw,matrix)
        x,y = _sample(dec,target);xs.append(x);ys.append(y)
    inverse_encoder = _fit(xs,ys)
    edited.release();encoded.release()
    _encode(repair,final,matrix,inverse_encoder)
    return final
