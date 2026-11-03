# APK 瘦包构建（pnpm --filter @gamebox/client-app build:app）
#
# 线上是三 Origin 架构，三个变量各指各的，不能混：
#   VITE_API_ORIGIN   下载/接口域，提供 /api 与 /uploads
#   VITE_ASSET_ORIGIN 素材域，提供 /images/games/ 与 /audio/（瘦包后按需下载）
#   VITE_GAME_ORIGIN  游戏域，提供 /games-assets/
VITE_SLIM_APP=1
VITE_API_ORIGIN=https://dfv4891.com
VITE_ASSET_ORIGIN=https://4150qd68.com
VITE_GAME_ORIGIN=https://4150qd68.com
# 备用线路，逗号分隔，不要空格也行。每个都必须在宝塔建站、开 HTTPS、反代 /api /uploads /public（素材站还要有 /images /audio /games-assets）
VITE_API_FALLBACK_ORIGINS=https://630489.com,https://6hfy.com,https://neimu743.com,https://65wete.com,https://16w1xv.com,https://ama006.com,https://xjz1918.com,https://4232323.com,https://nmzx618.com
VITE_ASSET_FALLBACK_ORIGINS=https://48iri.com,https://95cxzz.com,https://aigs798.com,https://rytn189.com
VITE_GAME_FALLBACK_ORIGINS=https://48iri.com,https://95cxzz.com,https://aigs798.com,https://rytn189.com
