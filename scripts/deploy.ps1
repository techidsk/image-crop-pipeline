param(
  [string]$HostName = "image-crop-server",
  [string]$User = "molook",
  [string]$RemoteDir = "/home/molook/code/image-crop-pipeline",
  [ValidateSet("patch", "full")]
  [string]$Mode = "patch",
  [switch]$AllowDirty
)

$ErrorActionPreference = "Stop"

function Write-Step {
  param([string]$Message)
  $timestamp = Get-Date -Format "HH:mm:ss"
  Write-Host "[$timestamp] $Message" -ForegroundColor Green
}

function Invoke-Checked {
  param([string]$Command)
  Write-Host "       $Command" -ForegroundColor DarkCyan
  Invoke-Expression $Command
  if ($LASTEXITCODE -ne 0) {
    throw "Command failed with exit code $LASTEXITCODE"
  }
}

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $repoRoot

if (-not $AllowDirty) {
  $dirty = git status --porcelain
  if ($dirty) {
    Write-Host "Working tree has uncommitted changes:" -ForegroundColor Yellow
    $dirty | ForEach-Object { Write-Host "  $_" -ForegroundColor Yellow }
    throw "Commit changes first, or rerun with -AllowDirty."
  }
}

$remote = "$User@$HostName"
$commit = (git rev-parse --short HEAD).Trim()
$archive = Join-Path ([System.IO.Path]::GetTempPath()) "image-crop-pipeline-$commit.tar"
$remoteArchive = "/tmp/image-crop-pipeline-$commit.tar"

try {
  Write-Step "1/5 打包当前提交 $commit"
  Invoke-Checked "git archive --format=tar -o `"$archive`" HEAD"

  Write-Step "2/5 上传代码包到 $remote"
  Invoke-Checked "scp `"$archive`" ${remote}:$remoteArchive"

  $remoteScript = @"
set -euo pipefail

log() {
  printf '[%s] %s\n' "`$(date +%H:%M:%S)" "`$1"
}

cd "$RemoteDir"

log "远端 1/7 解包 $commit"
tar -xf "$remoteArchive" -C "$RemoteDir"
rm -f "$remoteArchive"

log "远端 2/7 查看工作区状态"
git status --short || true

if [ "$Mode" = "full" ]; then
  log "远端 3/7 完整重建 Docker Compose 服务"
  docker compose up -d --build
else
  log "远端 3/7 更新后端容器依赖和代码"
  docker exec image-crop-backend sh -lc 'if command -v apt-get >/dev/null 2>&1; then apt-get update && apt-get install -y --no-install-recommends libgomp1 && rm -rf /var/lib/apt/lists/*; elif command -v yum >/dev/null 2>&1; then yum install -y libgomp; elif command -v apk >/dev/null 2>&1; then apk add --no-cache libgomp; else echo "no supported package manager found for libgomp" >&2; exit 1; fi'
  docker cp backend/requirements-paddle.txt image-crop-backend:/app/backend/requirements-paddle.txt
  docker exec image-crop-backend python -m pip install --no-cache-dir -r /app/backend/requirements-paddle.txt
  docker cp backend/app/. image-crop-backend:/app/backend/app/
  docker restart image-crop-backend

  log "远端 4/7 等待后端健康检查"
  for i in `$(seq 1 40); do
    if curl -fsS http://127.0.0.1:8100/api/health >/dev/null; then
      log "后端已健康"
      break
    fi
    printf '.'
    sleep 1
    if [ "`$i" = "40" ]; then
      echo
      echo "backend health timeout" >&2
      exit 1
    fi
  done
  echo

  log "远端 5/7 固化后端镜像"
  docker commit image-crop-backend image-crop-pipeline-backend:latest >/dev/null

  log "远端 6/7 构建前端静态资源"
  npm run build

  log "远端 7/7 更新前端容器并固化镜像"
  docker cp dist/. image-crop-frontend:/usr/share/nginx/html/
  docker commit image-crop-frontend image-crop-pipeline-frontend:latest >/dev/null
fi

log "验证前端 HTTP"
curl -fsS -I http://127.0.0.1:8180/ | sed -n '1,8p'

log "验证后端 API"
curl -fsS http://127.0.0.1:8100/api/health
echo
"@

  $scriptBytes = [System.Text.Encoding]::UTF8.GetBytes($remoteScript)
  $scriptBase64 = [Convert]::ToBase64String($scriptBytes)
  Write-Step "3/5 执行远端部署脚本"
  Invoke-Checked "ssh $remote `"echo $scriptBase64 | base64 -d | bash`""

  Write-Step "4/5 清理本地临时文件"
  Write-Step "5/5 部署完成 $commit"
}
finally {
  if (Test-Path $archive) {
    Remove-Item -LiteralPath $archive -Force
  }
}
