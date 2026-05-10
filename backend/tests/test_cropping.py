from PIL import Image

from backend.app.cropping import make_crop, person_bounds
from backend.app.pose import HeuristicPoseProvider, Pose
from backend.app.schemas import CropPreset, PoseKeypoint


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
