#!/usr/bin/env bash
# CI 供应链安全门禁：扫描器必须由 CI 镜像预装并固定版本；缺失即失败，禁止静默跳过。
set -euo pipefail

readonly NPM_REGISTRY='https://registry.npmjs.org'
readonly REPORT_DIR="${SECURITY_REPORT_DIR:-scripts/security-artifacts}"
readonly SEMGREP_VERSION='1.172.0'
readonly GITLEAKS_VERSION='8.30.1'
readonly TRIVY_VERSION='0.73.0'

require_tool() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "[security] 缺少必需工具：$1" >&2
    exit 2
  fi
}

for tool in pnpm timeout semgrep gitleaks trivy tr; do
  require_tool "$tool"
done

assert_version() {
  local tool=$1 expected=$2 actual=$3
  if [[ "$actual" != *"$expected"* ]]; then
    echo "[security] $tool 版本不受信：$actual（要求 $expected）" >&2
    exit 2
  fi
}

assert_version semgrep "$SEMGREP_VERSION" "$(semgrep --version)"
assert_version gitleaks "$GITLEAKS_VERSION" "$(gitleaks version)"
assert_version trivy "$TRIVY_VERSION" "$(trivy --version | tr '\n' ' ')"

mkdir -p "$REPORT_DIR"

echo '[security] 依赖漏洞审计（官方 npm registry）'
# timeout 或 registry 不可用都会返回非 0，和发现 High/Critical 一样阻断发布。
timeout 180 pnpm audit \
  --registry="$NPM_REGISTRY" \
  --audit-level=high

echo '[security] Semgrep OWASP 静态分析'
semgrep scan \
  --config p/owasp-top-ten \
  --error \
  --metrics=off \
  --exclude node_modules \
  --exclude dist \
  --exclude client-app/android/app/src/main/assets/public \
  .

echo '[security] Gitleaks 全历史密钥扫描'
gitleaks git \
  --redact \
  --no-banner \
  --exit-code 1 \
  .

echo '[security] Trivy 依赖与配置扫描'
trivy fs \
  --scanners vuln,misconfig \
  --severity HIGH,CRITICAL \
  --exit-code 1 \
  --skip-dirs node_modules \
  --skip-dirs .git \
  .

echo '[security] 生成 CycloneDX SBOM'
trivy fs \
  --scanners vuln \
  --format cyclonedx \
  --output "$REPORT_DIR/sbom.cdx.json" \
  --skip-dirs node_modules \
  --skip-dirs .git \
  .

echo "[security] 门禁通过；SBOM：$REPORT_DIR/sbom.cdx.json"
