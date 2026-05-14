# 本地内网部署与产品化方案

本文档面向“把图片批量裁切服务部署到公司内网，方便同事通过浏览器使用”的场景，同时分析是否需要做成 Tauri 桌面应用，以及模型下载管理页面应该怎么设计。

## 结论建议

当前阶段建议优先采用：

```text
一台内网服务器 / 工作站
  -> Docker Compose 启动前端 + 后端
  -> 模型文件放在服务器 models 目录
  -> 同事通过浏览器访问 http://内网IP:8080
```

不建议第一版直接做成 Tauri 桌面应用。原因是这个系统的核心价值是“统一模型、统一预设、统一批处理结果和任务记录”，这些更适合放在一台内网机器上集中部署。如果做成每个人电脑上独立跑的 Tauri 应用，需要额外处理模型下载、依赖安装、CPU 性能差异、磁盘空间、版本升级和数据同步，维护成本会明显升高。

更合适的路线是：

1. 第一阶段：内网 Web 服务，Docker Compose 部署。
2. 第二阶段：在 Web 管理后台增加“模型管理”页面。
3. 第三阶段：如果确实有离线单机使用需求，再做 Tauri 启动器或桌面版。

## 方案对比

### 方案 A：内网 Web 服务，推荐

适用场景：

- 同事没有开发环境，不想安装 Python、Node、Docker。
- 希望大家访问同一个地址使用。
- 模型文件较大，希望集中下载和维护。
- 批量输出结果希望集中落盘到服务器目录。

优点：

- 使用者只需要浏览器。
- 运维简单，一台机器更新即可。
- 预设、场景、训练样本和任务历史统一管理。
- 可以后续接权限、共享目录、NAS、备份。

缺点：

- 需要一台稳定运行的内网机器。
- 图片会上传到服务端处理，需注意内网数据规范。
- 如果多人同时处理大批量图片，CPU 压力集中在服务器。

### 方案 B：Tauri 桌面应用

适用场景：

- 用户必须完全离线单机使用。
- 每个人处理自己的本地图片，不需要共享任务记录。
- 希望双击安装包即可打开应用。

优点：

- 体验像本地软件。
- 可以直接访问用户本地文件系统。
- 不依赖内网服务器。

缺点：

- 仍然要内置或启动 Python/FastAPI 后端，打包复杂。
- 模型文件大，安装包和更新机制会变重。
- 每台电脑性能不一致，处理速度不可控。
- 模型下载失败、依赖损坏、杀毒软件拦截等问题会转移到每个用户电脑上。
- 预设和任务记录分散，团队协作不方便。

### 方案 C：Tauri 作为内网 Web 的启动器

这个可以作为后续增强，而不是第一版主方案。

做法是 Tauri 只负责：

- 打开内网 Web 页面。
- 记住服务器地址。
- 提供少量本地文件夹选择能力。
- 必要时做自动更新。

它不负责真正跑模型，也不负责模型下载。这样桌面体验会更好，但核心服务仍集中部署。

## 推荐架构

```text
用户浏览器
  |
  | 访问 http://内网IP:8080
  v
Nginx 前端容器
  |
  | /api 反向代理
  v
FastAPI 后端容器
  |
  | 读取模型
  v
./models/rtmw-l-384x288.onnx
  |
  | 写入数据和输出
  v
./backend/data
./outputs
```

当前项目已经具备这套基础：

- 前端：Vite + React，构建后由 Nginx 托管。
- 后端：FastAPI。
- Compose：已有 `docker-compose.yml`。
- 模型目录：已有 `models/`。
- 持久化数据：`backend/data/`。
- 批量输出：`outputs/`。

## 服务器要求

最低建议：

- 操作系统：Windows 10/11、Windows Server、Linux 均可。
- CPU：4 核以上。
- 内存：8 GB 以上，推荐 16 GB。
- 磁盘：至少预留 20 GB，按图片批量输出规模增加。
- 网络：同事电脑能访问部署机器的 `8080` 端口。
- 软件：Docker Desktop 或 Docker Engine。

如果后续使用更重的模型或 GPU 推理，需要单独设计 GPU 版镜像。当前 Compose 默认使用 CPU ONNX Runtime。

## 首次部署

在部署机器上进入项目目录：

```powershell
cd C:\Code\image-crop-pipeline
```

创建环境变量文件：

```powershell
Copy-Item .env.example .env
```

确认 `.env` 内容：

```env
APP_PORT=8080
POSE_PROVIDER=rtmw
RTMW_ONNX_PATH=models/rtmw-l-384x288.onnx
RTMW_INPUT_WIDTH=288
RTMW_INPUT_HEIGHT=384
MODEL_AUTO_DOWNLOAD=false
MODEL_DOWNLOAD_REQUIRED=false
RTMW_MODEL_URL=https://download.openmmlab.com/mmpose/v1/projects/rtmw/onnx_sdk/rtmw-dw-x-l_simcc-cocktail14_270e-384x288_20231122.zip
RTMW_MODEL_SHA256=
```

创建持久化目录：

```powershell
New-Item -ItemType Directory -Force models, outputs, backend\data | Out-Null
```

放置模型文件：

```text
models/rtmw-l-384x288.onnx
```

如果希望服务启动时自动下载模型，把 `.env` 改成：

```env
MODEL_AUTO_DOWNLOAD=true
```

后端会在 `RTMW_ONNX_PATH` 指向的模型不存在时自动下载 `RTMW_MODEL_URL`。如果下载的是 zip 包，会自动提取其中的 `.onnx` 文件并写入 `models/rtmw-l-384x288.onnx`。

内网部署更推荐把模型包先放到公司内网文件服务器，然后配置：

```env
MODEL_AUTO_DOWNLOAD=true
RTMW_MODEL_URL=http://内网文件服务器/rtmw-dw-x-l_simcc-cocktail14_270e-384x288_20231122.zip
```

如果需要保证模型完整性，可以计算 ONNX 文件的 SHA256 后配置：

```env
RTMW_MODEL_SHA256=模型文件的sha256
```

注意：自动下载需要部署机器或容器能访问 `RTMW_MODEL_URL`，并且 `models/` 目录可写。

默认情况下，模型下载失败不会阻止服务启动，后端会继续回退到 `heuristic` 方案，方便先打开系统排查问题。如果希望模型下载失败就让容器启动失败，可以配置：

```env
MODEL_DOWNLOAD_REQUIRED=true
```

启动服务：

```powershell
docker compose up -d --build
```

查看服务状态：

```powershell
docker compose ps
docker compose logs -f backend
```

在部署机器上访问：

```text
http://localhost:8080
```

在同事电脑上访问：

```text
http://部署机器内网IP:8080
```

例如：

```text
http://192.168.1.20:8080
```

## 日常运维

重启服务：

```powershell
docker compose restart
```

更新代码后重新构建：

```powershell
docker compose up -d --build
```

查看后端日志：

```powershell
docker compose logs -f backend
```

停止服务：

```powershell
docker compose down
```

备份关键数据：

```text
backend/data/
models/
outputs/
```

其中：

- `backend/data/` 保存预设、场景、训练样本和任务数据库。
- `models/` 保存模型文件。
- `outputs/` 保存批量处理输出结果。

## 模型管理页面设计

你提到的“下载模型管理页面”是有价值的，但建议做在 Web 管理后台里，而不是一开始做进 Tauri。

建议新增一个“系统设置 / 模型管理”页面，包含：

- 当前模型状态：未安装、已安装、加载成功、加载失败。
- 当前模型路径：例如 `models/rtmw-l-384x288.onnx`。
- 模型文件大小、修改时间、校验值。
- 下载按钮：从配置好的模型地址下载。
- 删除/替换按钮：管理员操作。
- 加载测试：调用后端接口确认模型可用。
- 推理模式切换：RTMW ONNX / Heuristic。

后端可以新增接口：

```text
GET  /api/models
POST /api/models/download
POST /api/models/activate
POST /api/models/test
DELETE /api/models/{model_id}
```

模型下载需要注意：

- 下载过程应显示进度。
- 下载到临时文件，完成后再移动到正式路径，避免半截模型被加载。
- 建议校验 SHA256。
- 模型下载地址最好可配置，不要硬编码在前端。
- 内网环境可能不能访问公网，最好支持管理员手动上传模型。

更适合企业内网的做法：

```text
管理员先把模型放到内网文件服务器 / NAS / 对象存储
  -> 模型管理页从内网地址下载
  -> 后端校验并激活模型
```

## 是否需要用户本机 Docker

如果目标是“同事使用”，不建议要求每个同事电脑安装 Docker。Docker 只应该安装在部署机器上。

同事侧应该是：

```text
打开浏览器 -> 上传图片 -> 选择场景/预设 -> 下载或查看输出
```

这比“每个人装 Docker 或 Tauri 后端”更可控。

## 输出目录问题

当前批处理支持填写输出目录。Docker 部署时，容器内默认工作目录是 `/app`，相对目录 `outputs` 会写入容器内 `/app/outputs`，并映射到宿主机项目目录下的：

```text
./outputs
```

建议内网部署时统一让用户使用默认输出目录，不暴露任意服务器路径。后续可以做成：

- 页面不让普通用户填写路径。
- 管理员在配置中设置输出根目录。
- 每个任务自动生成独立目录。
- 页面提供“下载 ZIP”或“打开结果目录”。

## 安全与权限建议

内网第一版可以先不做复杂登录，但至少建议：

- 只开放内网访问，不直接暴露公网。
- Windows 防火墙只允许内网网段访问 `8080`。
- Nginx 限制上传大小，当前配置是 `512m`。
- 定期清理 `outputs/`，避免磁盘被占满。
- 如果图片涉及敏感内容，增加登录和操作日志。

如果多人长期使用，建议后续增加：

- 管理员账号。
- 普通用户账号。
- 任务归属。
- 输出结果按用户隔离。
- 模型管理只允许管理员操作。

## 推荐迭代路线

### 第一阶段：可用部署

目标：让同事可以通过内网浏览器使用。

需要完成：

- 使用 Docker Compose 在一台内网机器部署。
- 放置 RTMW ONNX 模型。
- 确认同事电脑可以访问 `http://内网IP:8080`。
- 明确输出目录和备份策略。

### 第二阶段：运维友好

目标：非开发人员也能管理模型和状态。

建议增加：

- 模型管理页面。
- 后端模型状态接口。
- 模型手动上传或内网下载。
- 健康检查页面。
- 输出目录 ZIP 下载。

### 第三阶段：桌面增强，可选

目标：给需要本机体验的人提供桌面入口。

建议只做轻量 Tauri：

- 打开内网服务地址。
- 保存服务器地址。
- 检查服务是否可访问。
- 必要时引导用户联系管理员。

只有在明确需要“每台电脑独立离线推理”时，才考虑完整 Tauri 本地推理版。

## 最终建议

这个项目当前最自然的落地方式是“集中式内网 Web 服务”。Tauri 可以先不要做成主方案，否则会把模型、依赖和更新问题扩散到每个使用者电脑上。

更稳的产品形态是：

```text
管理员部署一次 Docker 服务
同事浏览器使用
模型管理放在 Web 后台
后续再按需要补 Tauri 启动器
```

这样既能快速上线，也给后续的模型管理、权限、输出归档和桌面体验留下空间。
