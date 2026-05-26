from io import BytesIO
import base64
from PIL import Image

from .pose import Pose
from .schemas import CropBox, CropPreset, CropResult

BODY_BOUND_KEYPOINTS = {
    "nose",
    "left_eye",
    "right_eye",
    "left_ear",
    "right_ear",
    "neck",
    "left_shoulder",
    "right_shoulder",
    "left_elbow",
    "right_elbow",
    "left_wrist",
    "right_wrist",
    "left_hip",
    "right_hip",
    "left_knee",
    "right_knee",
    "left_ankle",
    "right_ankle",
}

HEAD_KEYPOINTS = {
    "nose",
    "left_eye",
    "right_eye",
    "left_ear",
    "right_ear",
}

HAND_KEYPOINTS = {
    "left_wrist",
    "right_wrist",
}

HEAD_GUARD_MARGIN_RATIO = 0.035
HAND_GUARD_MARGIN_RATIO = 0.05


def person_bounds(pose: Pose) -> tuple[float, float, float, float] | None:
    points = [
        point
        for point in pose.keypoints
        if point.confidence > 0.05 and point.name in BODY_BOUND_KEYPOINTS
    ]
    if not points:
        points = [point for point in pose.keypoints if point.confidence > 0.05]
    if not points:
        return None
    left = min(point.x for point in points)
    top = min(point.y for point in points)
    right = max(point.x for point in points)
    bottom = max(point.y for point in points)
    if right <= left or bottom <= top:
        return None
    return left, top, right, bottom


def fit_box_to_ratio(
    left: float,
    top: float,
    width: float,
    height: float,
    ratio: float,
) -> tuple[int, int, int, int]:
    center_x = left + width / 2
    center_y = top + height / 2
    if width / height > ratio:
        height = width / ratio
    else:
        width = height * ratio
    next_left = round(center_x - width / 2)
    next_top = round(center_y - height / 2)
    next_width = max(1, round(width))
    next_height = max(1, round(height))
    return next_left, next_top, next_width, next_height


def expand_box_to_include_points(
    left: int,
    top: int,
    width: int,
    height: int,
    points: list[tuple[float, float]],
    ratio: float,
    margin: float,
) -> tuple[int, int, int, int]:
    if not points:
        return left, top, width, height
    required_left = min([left, *[point[0] - margin for point in points]])
    required_top = min([top, *[point[1] - margin for point in points]])
    required_right = max([left + width, *[point[0] + margin for point in points]])
    required_bottom = max([top + height, *[point[1] + margin for point in points]])
    return fit_box_to_ratio(
        required_left,
        required_top,
        required_right - required_left,
        required_bottom - required_top,
        ratio,
    )


def constrain_box_to_image(
    left: int,
    top: int,
    width: int,
    height: int,
    image: Image.Image,
    ratio: float,
) -> tuple[int, int, int, int]:
    width = max(1, width)
    height = max(1, height)
    if width > image.width:
        width = image.width
        height = max(1, round(width / ratio))
    if height > image.height:
        height = image.height
        width = max(1, round(height * ratio))
    if width > image.width:
        width = image.width
    if height > image.height:
        height = image.height
    left = max(0, min(left, image.width - width))
    top = max(0, min(top, image.height - height))
    return left, top, width, height


def median(values: list[float]) -> float:
    ordered = sorted(values)
    middle = len(ordered) // 2
    if len(ordered) % 2 == 0:
        return (ordered[middle - 1] + ordered[middle]) / 2
    return ordered[middle]


def average_point(pose: Pose, names: list[str]) -> tuple[float, float] | None:
    points = [point for name in names if (point := pose.point(name)) and point.confidence > 0.05]
    if not points:
        return None
    return median([point.x for point in points]), median([point.y for point in points])


def head_guard_points(pose: Pose) -> list[tuple[float, float]]:
    points = [
        (point.x, point.y)
        for point in pose.keypoints
        if point.confidence > 0.05 and (point.name in HEAD_KEYPOINTS or point.name.startswith("face_"))
    ]
    frame = semantic_frame(pose)
    if frame is not None and isinstance(frame["anchors"], dict):
        head_top = frame["anchors"].get("head_top")
        if isinstance(head_top, (int, float)):
            points.append((float(frame["center_x"]), float(head_top)))
    return points


def hand_guard_points(pose: Pose) -> list[tuple[float, float]]:
    return [
        (point.x, point.y)
        for point in pose.keypoints
        if point.confidence > 0.05 and (point.name in HAND_KEYPOINTS or "_hand_" in point.name)
    ]


def apply_crop_guards(
    image: Image.Image,
    pose: Pose,
    preset: CropPreset,
    left: int,
    top: int,
    width: int,
    height: int,
) -> tuple[int, int, int, int]:
    ratio = preset.width / preset.height
    min_dimension = min(image.width, image.height)
    if preset.protectHead:
        left, top, width, height = expand_box_to_include_points(
            left,
            top,
            width,
            height,
            head_guard_points(pose),
            ratio,
            max(24.0, min_dimension * HEAD_GUARD_MARGIN_RATIO),
        )
    if preset.protectHands:
        left, top, width, height = expand_box_to_include_points(
            left,
            top,
            width,
            height,
            hand_guard_points(pose),
            ratio,
            max(32.0, min_dimension * HAND_GUARD_MARGIN_RATIO),
        )
    return left, top, width, height


def semantic_frame(pose: Pose) -> dict[str, object] | None:
    bounds = person_bounds(pose)
    shoulder = average_point(pose, ["left_shoulder", "right_shoulder"])
    hip = average_point(pose, ["left_hip", "right_hip"])
    if bounds is None or shoulder is None or hip is None:
        return None
    left, top, right, bottom = bounds
    body_width = max(1.0, right - left)
    body_height = max(1.0, bottom - top)
    torso_height = max(1.0, abs(hip[1] - shoulder[1]))
    knee = average_point(pose, ["left_knee", "right_knee"])
    ankle = average_point(pose, ["left_ankle", "right_ankle"])
    face_points = [
        point
        for name in ["nose", "left_eye", "right_eye", "left_ear", "right_ear"]
        if (point := pose.point(name)) and point.confidence > 0.05
    ]
    face_top = min([point.y for point in face_points], default=top)
    nose = pose.point("nose")
    neck = pose.point("neck")
    chest_y = shoulder[1] + (hip[1] - shoulder[1]) * 0.35
    anchors = {
        "head_top": min(face_top - torso_height * 0.28, top),
        "face_top": face_top,
        "nose": nose.y if nose and nose.confidence > 0.05 else face_top,
        "neck": neck.y if neck and neck.confidence > 0.05 else shoulder[1] - torso_height * 0.12,
        "shoulder": shoulder[1],
        "chest": chest_y,
        "hip": hip[1],
    }
    if knee is not None:
        anchors["thigh_30"] = hip[1] + (knee[1] - hip[1]) * 0.3
        anchors["thigh_50"] = hip[1] + (knee[1] - hip[1]) * 0.5
        anchors["knee"] = knee[1]
    if knee is not None and ankle is not None:
        anchors["shin_50"] = knee[1] + (ankle[1] - knee[1]) * 0.5
    if ankle is not None:
        anchors["ankle"] = ankle[1]
    return {
        "center_x": median([shoulder[0], hip[0]]),
        "body_width": body_width,
        "body_height": body_height,
        "anchors": anchors,
    }


def make_semantic_crop_box(image: Image.Image, pose: Pose, preset: CropPreset) -> tuple[int, int, int, int]:
    frame = semantic_frame(pose)
    if frame is None:
        raise ValueError("Missing valid semantic pose frame")
    composition = preset.composition or {}
    anchors = frame["anchors"]
    if not isinstance(anchors, dict):
        raise ValueError("Missing semantic anchors")
    top_anchor = str(composition.get("topAnchor", "head_top"))
    bottom_anchor = str(composition.get("bottomAnchor", "thigh_30"))
    body_height = float(frame["body_height"])
    body_width = float(frame["body_width"])
    top = float(anchors.get(top_anchor, anchors.get("head_top", 0))) + float(composition.get("topOffset", 0)) * body_height
    bottom = float(anchors.get(bottom_anchor, anchors.get("thigh_30", image.height))) + float(composition.get("bottomOffset", 0)) * body_height
    if bottom <= top:
        bottom = top + max(1.0, float(composition.get("semanticHeight", 1)) * body_height)
    height = bottom - top
    width = height * (preset.width / preset.height)
    center_x = float(frame["center_x"]) + float(composition.get("centerOffset", 0)) * body_width
    left = round(center_x - width / 2)
    return left, round(top), max(1, round(width)), max(1, round(height))


def make_crop(image: Image.Image, pose: Pose, preset: CropPreset) -> CropResult:
    anchor = pose.point(preset.anchor)
    if anchor is None:
        raise ValueError(f"Missing pose anchor: {preset.anchor}")

    target_width = round(preset.width * preset.scale)
    target_height = round(preset.height * preset.scale)
    center_x = anchor.x + preset.offsetX
    center_y = anchor.y + preset.offsetY

    if preset.strategy == "pose_semantic_composition" and preset.composition:
        left, top, target_width, target_height = make_semantic_crop_box(image, pose, preset)
    elif preset.strategy == "learned_composition" and preset.composition:
        bounds = person_bounds(pose)
        if bounds is None:
            raise ValueError("Missing valid person bounds")
        person_left, person_top, person_right, person_bottom = bounds
        person_width = person_right - person_left
        person_height = person_bottom - person_top
        learned_left = person_left + person_width * preset.composition.get("left", 0)
        learned_top = person_top + person_height * preset.composition.get("top", 0)
        learned_width = person_width * preset.composition.get("width", 1)
        learned_height = person_height * preset.composition.get("height", 1)
        left, top, target_width, target_height = fit_box_to_ratio(
            learned_left,
            learned_top,
            learned_width,
            learned_height,
            preset.width / preset.height,
        )
    elif preset.strategy == "anchor_top":
        left = round(center_x - target_width / 2)
        top = round(anchor.y + preset.offsetY)
    elif preset.strategy == "full_height":
        source_ratio = preset.width / preset.height
        target_height = image.height
        target_width = round(target_height * source_ratio)
        left = round(center_x - target_width / 2)
        top = 0
    else:
        left = round(center_x - target_width / 2)
        top = round(center_y - target_height / 2)

    left, top, target_width, target_height = apply_crop_guards(
        image,
        pose,
        preset,
        left,
        top,
        target_width,
        target_height,
    )
    left, top, target_width, target_height = constrain_box_to_image(
        left,
        top,
        target_width,
        target_height,
        image,
        preset.width / preset.height,
    )

    right = left + target_width
    bottom = top + target_height
    source_box = CropBox(left=left, top=top, right=right, bottom=bottom)

    crop = image.crop((left, top, right, bottom)).resize((preset.width, preset.height), Image.Resampling.LANCZOS)

    buffer = BytesIO()
    save_kwargs = {}
    icc_profile = image.info.get("icc_profile")
    if icc_profile:
        save_kwargs["icc_profile"] = icc_profile
    crop.save(buffer, format="PNG", **save_kwargs)

    return CropResult(
        presetId=preset.id,
        name=preset.name,
        width=preset.width,
        height=preset.height,
        box=source_box,
        image=base64.b64encode(buffer.getvalue()).decode("ascii"),
    )
