from io import BytesIO
from pathlib import Path
from typing import BinaryIO

from PIL import Image, ImageCms

SRGB_PROFILE = ImageCms.createProfile("sRGB")
SRGB_PROFILE_BYTES = ImageCms.ImageCmsProfile(SRGB_PROFILE).tobytes()


def _has_alpha(image: Image.Image) -> bool:
    return image.mode in ("RGBA", "LA") or (
        image.mode == "P" and "transparency" in image.info
    )


def _convert_rgb_with_profile(image: Image.Image) -> Image.Image:
    icc_profile = image.info.get("icc_profile")
    if icc_profile:
        try:
            input_profile = ImageCms.ImageCmsProfile(BytesIO(icc_profile))
            return ImageCms.profileToProfile(
                image,
                input_profile,
                SRGB_PROFILE,
                outputMode="RGB",
            )
        except (ImageCms.PyCMSError, OSError, ValueError):
            pass
    return image.convert("RGB")


def open_image_as_srgb(source: str | Path | BinaryIO | BytesIO) -> Image.Image:
    image = Image.open(source)
    image.load()

    if _has_alpha(image):
        alpha = image.convert("RGBA").getchannel("A")
        rgb_input = image.convert("RGB")
        if "icc_profile" in image.info:
            rgb_input.info["icc_profile"] = image.info["icc_profile"]
        rgb = _convert_rgb_with_profile(rgb_input)
        converted = rgb.convert("RGBA")
        converted.putalpha(alpha)
    else:
        converted = _convert_rgb_with_profile(image)

    converted.info["icc_profile"] = SRGB_PROFILE_BYTES
    return converted
