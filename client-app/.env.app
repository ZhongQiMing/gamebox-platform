# APK 瘦包构建（pnpm --filter @gamebox/client-app build:app）
#
# 线上是三 Origin 架构，三个变量各指各的，不能混：
#   VITE_API_ORIGIN   下载/接口域，提供 /api 与 /uploads
#   VITE_ASSET_ORIGIN 素材域，提供 /images/games/ 与 /audio/（瘦包后按需下载）
#   VITE_GAME_ORIGIN  游戏域，提供 /games-assets/
VITE_SLIM_APP=1
VITE_API_ORIGIN=https://5323485.com
VITE_ASSET_ORIGIN=https://jinyuhui.games.5323485.com
VITE_GAME_ORIGIN=https://jinyuhui.games.5323485.com
# 备用线路，逗号分隔，不要空格也行。每个都必须在宝塔建站、开 HTTPS、反代 /api /uploads /public（素材站还要有 /images /audio /games-assets）
# 例：VITE_API_FALLBACK_ORIGINS=https://jinyuhui.api.5323485.com,https://别的字母域名.com
VITE_API_FALLBACK_ORIGINS=https://it3814.com,https://mz66888.com,https://by4169.com,https://in8023.com,https://an19373.com,https://7304921.com,https://6147285.com
VITE_ASSET_FALLBACK_ORIGINS=
VITE_GAME_FALLBACK_ORIGINS=
