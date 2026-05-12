# OpenPose Crop Pipeline

前后端分离的图片批量裁切工作台：

- 前端：Vite + Bun + React
- 后端：Python + FastAPI + Pillow
- 核心流程：批量上传图片 -> 姿态节点识别 -> 以 OpenPose 节点作为锚点 -> 按多个预设输出不同尺寸裁切图

## 运行

```powershell
bun install
python -m venv .venv
.\.venv\Scripts\python -m pip install -r backend\requirements.txt pytest
.\.venv\Scripts\python -m uvicorn backend.app.main:app --reload --port 8000
bun run dev
```

打开 `http://localhost:5174`。

## 验证

```powershell
.\.venv\Scripts\python -m pytest backend\tests
bun run build
```

## Docker Compose 部署

项目提供了前后端分离的 Compose 部署：

- `frontend`：Bun 构建 Vite 静态资源，Nginx 托管页面，并把 `/api` 反向代理到后端
- `backend`：FastAPI + Pillow + ONNX Runtime
- `./backend/data`：持久化预设、场景、训练样本和 SQLite 任务记录
- `./models`：放置 RTMW ONNX 模型
- `./outputs`：批量任务默认输出目录

首次部署：

```powershell
Copy-Item .env.example .env
New-Item -ItemType Directory -Force models, outputs | Out-Null
docker compose up -d --build
```

打开 `http://localhost:8080`。

如果已有 RTMW-l ONNX 模型，放到：

```text
models/rtmw-l-384x288.onnx
```

如果模型不存在，后端会回退到轻量 `heuristic` 方案，方便先跑通部署链路。批量任务里填写相对输出目录 `outputs` 时，容器会写入宿主机的 `./outputs` 目录。任务历史会写入 `backend/data/app.db`，预设和场景仍保留为 JSON，方便查看和版本管理。

常用命令：

```powershell
docker compose logs -f backend
docker compose restart backend
docker compose down
```

## 裁切预设

每个预设包含：

- `name`：预设名称
- `tags`：标签列表，用于批量处理时检索和筛选
- `width` / `height`：输出图片尺寸
- `anchor`：使用的姿态节点，例如 `neck`、`mid_hip`、`nose`
- `strategy`：裁切策略，例如 `anchor_center`、`anchor_top`、`full_height`
- `offsetX` / `offsetY`：基于锚点的像素偏移
- `scale`：先按比例取源图区域，再缩放到输出尺寸

前端使用 sidebar 导航，包含“批量处理”和“预设管理”两个主页面。预设管理页用于检索、筛选和进入单个预设；单个预设有独立编辑页面，基础参数和训练流程都在编辑页里完成。

预设不是硬编码在前端里，后端会持久化到 `backend/data/presets.json`。前端启动时通过 `GET /api/presets` 加载，编辑、复制、删除和训练策略后通过 `PUT /api/presets` 保存。

## 策略训练

“预设管理”里可以上传多张样本图训练构图策略：

- 每组样本由一张原图和一个人工裁切框组成
- 最少需要 5 组样本
- 后端先识别每张图的 OpenPose 节点
- 前端允许在原图上手动画裁切框，也可以直接编辑裁切框坐标
- 训练裁切框会锁定为基础信息里的 `width / height` 宽高比
- 点击“训练构图策略”后，会从人体姿态点中分析语义构图，例如上边界接近头顶、面部或肩线，下边界接近髋部、大腿比例、膝盖或脚踝
- 训练时会过滤语义边界偏差过大的样本，再用剩余样本的中位数生成 `pose_semantic_composition` 预设

当前后端的 `HeuristicPoseProvider` 是可运行占位实现，用来打通前后端和裁切链路。接真实 OpenPose 时，只需要在 `backend/app/pose.py` 中新增 provider，并让 `main.py` 使用真实 provider 返回同样的 `PoseKeypoint` 列表。

## RTMW-l 姿态识别

后端支持通过环境变量切换到 RTMW-l 384x288 whole-body pose provider。默认仍使用轻量占位 provider，方便本地开发。推荐使用 ONNX Runtime 路径，避免把 `torch` 装进主环境。

安装 ONNX 可选依赖：

```powershell
.\.venv\Scripts\python -m pip install -r backend\requirements-onnx.txt
```

启动 ONNX RTMW：

```powershell
$env:POSE_PROVIDER="rtmw"
$env:RTMW_ONNX_PATH="models/rtmw-l-384x288.onnx"
$env:RTMW_INPUT_WIDTH="288"
$env:RTMW_INPUT_HEIGHT="384"
.\.venv\Scripts\python -m uvicorn backend.app.main:app --host 127.0.0.1 --port 8000
```

ONNX 模型可以通过 MMDeploy 从 MMPose RTMW-l 配置导出，也可以放置已有的 RTMW-l 384x288 ONNX 文件到 `models/rtmw-l-384x288.onnx`。

如果要试 Hugging Face/Transformers 版本，可以安装重依赖：

```powershell
.\.venv\Scripts\python -m pip install -r backend\requirements-rtmw.txt
```

启动 Transformers 版本：

```powershell
$env:POSE_PROVIDER="rtmw_transformers"
$env:RTMW_MODEL="akore/rtmw-l-384x288"
.\.venv\Scripts\python -m uvicorn backend.app.main:app --host 127.0.0.1 --port 8000
```

当前 RTMW provider 会把整张图作为单人主体输入模型，适合单人或主体人物明显的图片。裁切训练和后端语义构图会优先使用身体主干点，例如头、肩、肘、腕、胯、膝、踝，避免 whole-body 的手指或脸部细点把 bbox 拉偏。后续如果需要多人图，可以再接人体检测器，并在前端加入主体人物选择。
