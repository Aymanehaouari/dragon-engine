#!/usr/bin/env python3
from pathlib import Path
import os
import shutil
import stat
import imageio_ffmpeg

root = Path(__file__).resolve().parent.parent
tools = Path(os.environ.get("OMNIGET_TOOLS_DIR", str(root / ".tools")))
tools.mkdir(parents=True, exist_ok=True)

src = Path(imageio_ffmpeg.get_ffmpeg_exe())
dst = tools / "ffmpeg"
shutil.copy2(src, dst)
dst.chmod(dst.stat().st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)
print(dst)
