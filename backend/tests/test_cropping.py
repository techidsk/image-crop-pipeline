import pytest
from PIL import Image
from pydantic import ValidationError

from backend.app.cropping import make_crop, person_bounds
from backend.app.main import detect_pose, presets_for_view
from backend.app.pose import HeuristicPoseProvider, Pose, classify_pose_view
from backend.app.schemas import CropPreset, PoseKeypoint
from backend.app.view_classifier import parse_paddle_direction, parse_person_attribute_logits, person_crop


def test_crop_preset_normalizes_and_deduplicates_tags():
    preset = CropPreset(
        id="tagged",
        name="Tagged",
        tags=["Portrait", " portrait ", "upper-body"],
        width=100,
        height=100,
        anchor="neck",
    )

    assert preset.tags == ["portrait", "upper-body"]


def test_crop_preset_rejects_invalid_tags():
    with pytest.raises(ValidationError):
        CropPreset(
            id="tagged",
            name="Tagged",
            tags=["portrait", "bad tag"],
            width=100,
            height=100,
            anchor="neck",
        )


def test_make_crop_uses_anchor_and_target_size():
    image = Image.new("RGB", (2000, 2000), "white")
    pose = HeuristicPoseProvider().detect(image)
    preset = CropPreset(
        id="portrait",
        name="Portrait",
        width=1800,
        height=2000,
        anchor="neck",
        offsetX=0,
        offsetY=320,
        scale=1,
    )

    result = make_crop(image, pose, preset)

    assert result.width == 1800
    assert result.height == 2000
    assert result.box.left == 100
    assert result.box.right == 1900
    assert result.image


def test_make_crop_uses_learned_composition():
    image = Image.new("RGB", (2000, 2000), "white")
    pose = HeuristicPoseProvider().detect(image)
    preset = CropPreset(
        id="learned",
        name="Learned",
        width=900,
        height=1200,
        anchor="neck",
        strategy="learned_composition",
        composition={"left": -0.2, "top": -0.1, "width": 1.4, "height": 1.3},
    )

    result = make_crop(image, pose, preset)

    assert result.width == 900
    assert result.height == 1200
    assert result.box.left < result.box.right
    assert result.box.top < result.box.bottom
    assert result.image


def test_learned_composition_bbox_matches_output_ratio():
    image = Image.new("RGB", (2000, 2000), "white")
    pose = HeuristicPoseProvider().detect(image)
    preset = CropPreset(
        id="learned-ratio",
        name="Learned Ratio",
        width=900,
        height=1200,
        anchor="neck",
        strategy="learned_composition",
        composition={"left": -0.2, "top": -0.1, "width": 2.0, "height": 0.7},
    )

    result = make_crop(image, pose, preset)
    box_width = result.box.right - result.box.left
    box_height = result.box.bottom - result.box.top

    assert result.width == 900
    assert result.height == 1200
    assert abs(box_width / box_height - 0.75) < 0.001


def test_make_crop_uses_pose_semantic_composition():
    image = Image.new("RGB", (2000, 2000), "white")
    pose = HeuristicPoseProvider().detect(image)
    preset = CropPreset(
        id="semantic",
        name="Semantic",
        width=900,
        height=1200,
        anchor="neck",
        strategy="pose_semantic_composition",
        composition={
            "mode": "pose_semantic",
            "topAnchor": "head_top",
            "topOffset": 0.02,
            "bottomAnchor": "thigh_30",
            "bottomOffset": 0.0,
            "centerAnchor": "torso_center",
            "centerOffset": 0.0,
        },
    )

    result = make_crop(image, pose, preset)
    box_width = result.box.right - result.box.left
    box_height = result.box.bottom - result.box.top

    assert result.width == 900
    assert result.height == 1200
    assert result.box.top < 400
    assert 0.74 < box_width / box_height < 0.76
    assert result.image


def test_make_crop_can_protect_head_keypoints():
    image = Image.new("RGB", (600, 600), "white")
    pose = Pose(
        keypoints=[
            PoseKeypoint(name="neck", x=300, y=300, confidence=0.9),
            PoseKeypoint(name="nose", x=300, y=50, confidence=0.9),
        ]
    )
    preset = CropPreset(
        id="head-safe",
        name="Head Safe",
        width=100,
        height=100,
        anchor="neck",
        protectHead=True,
    )

    result = make_crop(image, pose, preset)

    assert result.box.top <= 26
    assert result.box.left <= 276
    assert result.box.right >= 324


def test_make_crop_can_protect_hand_keypoints():
    image = Image.new("RGB", (600, 600), "white")
    pose = Pose(
        keypoints=[
            PoseKeypoint(name="neck", x=300, y=300, confidence=0.9),
            PoseKeypoint(name="right_hand_8", x=500, y=300, confidence=0.9),
        ]
    )
    preset = CropPreset(
        id="hand-safe",
        name="Hand Safe",
        width=100,
        height=100,
        anchor="neck",
        protectHands=True,
    )

    result = make_crop(image, pose, preset)

    assert result.box.right >= 530
    assert result.box.top < 250
    assert result.box.bottom > 350


def test_make_crop_does_not_pad_beyond_source_image():
    image = Image.new("RGB", (600, 600), "white")
    pose = Pose(
        keypoints=[
            PoseKeypoint(name="neck", x=50, y=50, confidence=0.9),
            PoseKeypoint(name="nose", x=10, y=10, confidence=0.9),
        ]
    )
    preset = CropPreset(
        id="no-padding",
        name="No Padding",
        width=300,
        height=300,
        anchor="neck",
        protectHead=True,
    )

    result = make_crop(image, pose, preset)

    assert result.box.left == 0
    assert result.box.top == 0
    assert result.box.right <= image.width
    assert result.box.bottom <= image.height
    assert result.image


def test_person_bounds_prefers_body_points_over_wholebody_extremes():
    pose = Pose(
        keypoints=[
            PoseKeypoint(name="left_shoulder", x=100, y=100, confidence=0.9),
            PoseKeypoint(name="right_shoulder", x=300, y=100, confidence=0.9),
            PoseKeypoint(name="left_ankle", x=120, y=500, confidence=0.9),
            PoseKeypoint(name="right_ankle", x=280, y=500, confidence=0.9),
            PoseKeypoint(name="left_hand_1", x=-1000, y=-1000, confidence=0.9),
        ]
    )

    assert person_bounds(pose) == (100, 100, 300, 500)


def test_classify_pose_view_front_for_balanced_face_and_body():
    pose = HeuristicPoseProvider().detect(Image.new("RGB", (1000, 1000), "white"))

    assert classify_pose_view(pose) == "front"


def test_classify_pose_view_back_when_face_is_missing():
    pose = Pose(
        keypoints=[
            PoseKeypoint(name="left_shoulder", x=420, y=300, confidence=0.9),
            PoseKeypoint(name="right_shoulder", x=580, y=300, confidence=0.9),
            PoseKeypoint(name="left_hip", x=440, y=600, confidence=0.9),
            PoseKeypoint(name="right_hip", x=560, y=600, confidence=0.9),
            PoseKeypoint(name="left_knee", x=450, y=780, confidence=0.9),
            PoseKeypoint(name="right_knee", x=550, y=780, confidence=0.9),
            PoseKeypoint(name="nose", x=500, y=220, confidence=0.02),
        ]
    )

    assert classify_pose_view(pose) == "back"


def test_classify_pose_view_back_when_face_points_land_on_hair_region():
    image = Image.new("RGB", (1000, 1200), "white")
    pixels = image.load()
    for y in range(160, 330):
        for x in range(400, 600):
            pixels[x, y] = (32, 24, 20)
    pose = Pose(
        keypoints=[
            PoseKeypoint(name="left_shoulder", x=380, y=420, confidence=0.9),
            PoseKeypoint(name="right_shoulder", x=620, y=420, confidence=0.9),
            PoseKeypoint(name="left_hip", x=420, y=760, confidence=0.9),
            PoseKeypoint(name="right_hip", x=580, y=760, confidence=0.9),
            PoseKeypoint(name="left_knee", x=430, y=980, confidence=0.9),
            PoseKeypoint(name="right_knee", x=570, y=980, confidence=0.9),
            PoseKeypoint(name="nose", x=500, y=240, confidence=0.9),
            PoseKeypoint(name="left_eye", x=465, y=230, confidence=0.9),
            PoseKeypoint(name="right_eye", x=535, y=230, confidence=0.9),
            PoseKeypoint(name="face_1", x=430, y=250, confidence=0.9),
            PoseKeypoint(name="face_2", x=570, y=250, confidence=0.9),
            PoseKeypoint(name="face_3", x=500, y=305, confidence=0.9),
        ]
    )

    assert classify_pose_view(pose, image) == "back"


def test_classify_pose_view_side_for_asymmetric_body_confidence():
    pose = Pose(
        keypoints=[
            PoseKeypoint(name="left_shoulder", x=500, y=300, confidence=0.9),
            PoseKeypoint(name="left_hip", x=510, y=600, confidence=0.9),
            PoseKeypoint(name="left_knee", x=520, y=780, confidence=0.9),
            PoseKeypoint(name="right_shoulder", x=560, y=310, confidence=0.22),
            PoseKeypoint(name="right_hip", x=570, y=610, confidence=0.2),
            PoseKeypoint(name="right_knee", x=580, y=790, confidence=0.18),
            PoseKeypoint(name="nose", x=500, y=220, confidence=0.8),
            PoseKeypoint(name="left_eye", x=490, y=205, confidence=0.8),
        ]
    )

    assert classify_pose_view(pose) == "side"


def test_presets_for_view_keeps_matching_or_unrestricted_presets():
    front = CropPreset(id="front", name="Front", width=100, height=100, anchor="neck", viewAngles=["front"])
    side = CropPreset(id="side", name="Side", width=100, height=100, anchor="neck", viewAngles=["side"])
    all_views = CropPreset(id="all", name="All", width=100, height=100, anchor="neck")

    assert [preset.id for preset in presets_for_view([front, side, all_views], "side")] == ["side", "all"]


def test_detect_pose_maps_resized_detection_back_to_source_coordinates():
    image = Image.new("RGB", (4000, 3000), "white")

    pose = detect_pose("heuristic", image)
    nose = pose.point("nose")

    assert nose is not None
    assert nose.x == 2000
    assert nose.y == 660


def test_parse_paddle_direction_from_nested_attribute_output():
    output = [
        {
            "attributes": [
                "Age: Over18",
                "Direction: Back",
            ]
        }
    ]

    assert parse_paddle_direction(output) == "back"


def test_parse_person_attribute_logits_uses_direction_slice():
    output = [0.0] * 26
    output[23] = 0.2
    output[24] = 0.4
    output[25] = 0.9

    assert parse_person_attribute_logits(output) == ("back", 0.9)


def test_person_crop_resizes_large_source_for_attribute_classification():
    image = Image.new("RGB", (4000, 4000), "white")
    pose = HeuristicPoseProvider().detect(image)

    crop = person_crop(image, pose)

    assert max(crop.size) <= 768
