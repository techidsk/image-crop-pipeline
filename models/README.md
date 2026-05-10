# RTMW-l 384x288 ONNX

This directory stores the project-local RTMW-l ONNX model used by the FastAPI pose provider.

- Runtime path: `models/rtmw-l-384x288.onnx`
- Source package: OpenMMLab MMPose RTMW ONNX SDK
- Original package URL: `https://download.openmmlab.com/mmpose/v1/projects/rtmw/onnx_sdk/rtmw-dw-x-l_simcc-cocktail14_270e-384x288_20231122.zip`

Start the backend with:

```powershell
$env:POSE_PROVIDER="rtmw"
$env:RTMW_ONNX_PATH="models/rtmw-l-384x288.onnx"
.\.venv\Scripts\python -m uvicorn backend.app.main:app --host 127.0.0.1 --port 8000
```
