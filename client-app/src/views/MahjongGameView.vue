<template>
  <!-- 第 0 步：正版进入页（加载动画 → 封面 → 点开始） -->
  <MahjongCover v-if="showPgCover" @start="onPgCoverStart" />

  <div v-show="!showPgCover" class="mahjong-game-page" :class="{ 'is-free-spin-bg': isInFreeSpinFeature }">
    <!-- 全屏铺底：专属封面2（与开始界面一致，宽屏两侧红金延伸） -->
    <img
      v-if="pageBgUrl"
      class="page-bg-fill"
      :src="pageBgUrl"
      alt=""
      aria-hidden="true"
      draggable="false"
    />

    <!-- 游戏画布（尺寸来自正版 dump cocosLayout.design） -->
    <div
      class="game-container"
      :class="{ 'is-free-spin-mode': isInFreeSpinFeature, 'is-using-fs-assets': isInFreeSpinFeature && hasFreeSpinBgAsset }"
      :style="canvasBoxStyle"
    >

      <!-- PG 正版叠层：底图 → 顶栏 → 牌面 → 信息带 → 底栏按钮 -->

      <!-- ① 主界面画布内：暗色纯色底；全屏红金延伸由 page-bg-fill 承担 -->
      <div
        class="layer layer-base z-bg"
        :class="{ 'is-free-spin-mode': isInFreeSpinFeature, 'is-using-fs-assets': isInFreeSpinFeature && hasFreeSpinBgAsset }"
        :style="pctLayerStyle(bgImage)"
      >
        <div v-if="isInFreeSpinFeature && !hasFreeSpinBgAsset" class="free-spin-bg-glow" aria-hidden="true" />
      </div>

      <!-- ①c 顶部元宝装饰条 main_top_a（中间木纹靠 z-wood-top 底色，两侧铜钱） -->
      <div
        v-if="pgStep >= 1 && topCoinsBarUrl && L.woodTop"
        class="layer z-wood-top"
        :style="pctLayerStyle(L.woodTop)"
      >
        <img class="layer-img layer-img--coins-bar" :src="topCoinsBarUrl" alt="" draggable="false" />
      </div>

      <!-- ② reel_a 整图：正版坐标，z=3 在牌层下方，绿毡+木框自然呈现 -->
      <div v-if="pgStep >= 2 && pgUi('reel-green') && L.reelFrame" class="layer z-reel-green" :style="pctLayerStyle(L.reelFrame)">
        <img class="layer-img" :src="pgUi('reel-green')!" alt="" />
      </div>
      <!-- ②b reel_glow：顶部暖光晕 -->
      <div v-if="pgStep >= 2 && playReels" class="layer z-reel-glow" :style="pctLayerStyle({ topPct: playReels.topPct, heightPct: playReels.heightPct * 0.3, leftPct: playReels.leftPct, widthPct: playReels.widthPct })"></div>
      <!-- ③ 底栏木框 main_bottom_a（木纹+元宝，底部自带渐暗） -->
      <div v-if="pgStep >= 3 && pgUi('bottom-wood')" class="layer z-wood" :style="pctLayerStyle(L.bottomWood)">
        <img class="layer-img" :src="pgUi('bottom-wood')!" alt="" draggable="false" />
      </div>

      <!-- ③a 底栏分隔条 main_bottom_b（橙色弧形盖帽，信息栏与底栏交界） -->
      <div v-if="pgStep >= 3 && pgUi('bg-bottom-bar') && L.bottomBar" class="layer z-bottom-bar" :style="pctLayerStyle(L.bottomBar)">
        <img class="layer-img" :src="pgUi('bg-bottom-bar')!" alt="" draggable="false" />
      </div>

      <!-- ③a-1 按钮区半透明暗层 footer_darken（Cocos: opacity=100, color=#000000）
           叠在木纹之上、按钮之下，让旋转按钮区域变暗 -->
      <div
        v-if="pgStep >= 3 && L.footerDarken"
        class="layer z-footer-darken"
        :style="pctLayerStyle(L.footerDarken)"
      />

      <!-- ③b 信息栏框
           Cocos dump 对照：
           stage 0 = 普通旋转（normal_frontBoard = infoboard_a 金框）
           stage 1 = 免费旋转模式（bonus_frontBoard  = infoboard_b 绿框）
           stage 2 = 大赢（medium_winboard = infoboard_c 紫框，覆盖在底框之上）
           三档的尺寸/坐标统一用 L.infoboard，紫框用 L.infoboardWin -->
      <div
        v-if="pgStep >= 3 && (L.infoboard || L.infoboardWin)"
        class="layer z-infoboard"
        :class="`infoboard-stage-${infoBoardStage}`"
        :style="pctLayerStyle(infoBoardStage === 2 ? (L.infoboardWin ?? L.infoboard!) : L.infoboard!)"
      >
        <img v-if="infoBoardStage === 2" class="layer-img" :src="pgUi('infoboard-c')!" alt="" />
        <img v-else-if="infoBoardStage === 1" class="layer-img" :src="pgUi('infoboard-b')!" alt="" />
        <img v-else class="layer-img" :src="pgUi('infoboard-a')!" alt="" />
      </div>

      <!-- ③c infoboard 内容层
           Cocos dump 对照：
           content/message (info2) = ticker，active 当 win=0
           win_content/win (win_info "赢得") = 普通旋转有赢时
           win_content/total_win (totalwin_info "共赢得") = 免费旋转中
           大赢(stage 2)也显示"赢得"；免费旋转时改"共赢得" -->
      <div
        v-if="pgStep >= 3 && L.infoboardText"
        class="layer z-infoboard-text"
        :class="{ 'is-win-display': hudWinDisplay > 0 }"
        :style="pctLayerStyle(infoBoardStage === 2 ? L.infoboardWin : L.infoboardText)"
      >
        <!-- 无赢：正版 PNG 广告文案（短句居中 / 长句滚出） -->
        <template v-if="hudWinDisplay <= 0">
          <div ref="adMsgContainerRef" class="ad-msg-container">
            <img
              v-if="currentAdMsgUrl"
              :key="adMsgAnimKey"
              class="ad-msg-img"
              :class="adMsgIsFit ? 'ad-msg-center' : 'ad-msg-scroll'"
              :style="adMsgIsFit ? {} : { '--scroll-dur': adMsgScrollDur }"
              :src="currentAdMsgUrl"
              draggable="false"
              alt=""
              @animationend="onAdMsgAnimEnd"
            />
          </div>
        </template>
        <!-- 有赢：显示赢钱金额（对应 win_content active=true） -->
        <template v-else>
          <div class="infoboard-win-content" :style="infoboardWinContentStyle">
            <!-- 第一次连击「赢得」，第二次起「共赢得」 -->
            <img
              v-if="infoboardWinIsTotal"
              class="infoboard-win-label"
              :src="pgUi('totalwin-info')!"
              alt="共赢得"
              draggable="false"
            />
            <img
              v-else
              class="infoboard-win-label"
              :src="pgUi('win-info')!"
              alt="赢得"
              draggable="false"
            />
            <!-- 金色精灵数字（来自 win-digits.png atlas） -->
            <span class="infoboard-win-digits" aria-hidden="true">
              <span
                v-for="(ch, i) in infoboardWinChars"
                :key="i"
                class="win-digit-sprite"
                :class="winDigitClass(ch)"
                :style="winDigitStyle(ch)"
              />
            </span>
          </div>
        </template>
      </div>

      <!-- ④b 倍数条底框 main_top_c（木纹底，在 1024 栏下方） -->
      <div
        v-if="pgStep >= 4 && multBarFrameUrl && L.multBarFrame"
        class="layer z-mult-bar"
        :class="{ 'is-free-spin-mode': isInFreeSpinFeature, 'is-using-fs-assets': isInFreeSpinFeature && hasFreeSpinBgAsset }"
        :style="pctLayerStyle(L.multBarFrame)"
      >
        <img class="layer-img layer-img--mult-bar" :src="multBarFrameUrl" alt="" />
      </div>

      <!-- ⑥a 激活光晕：完整 multiplier_glow，由木纹条 overflow 裁切（正版做法） -->
      <div
        v-if="pgStep >= 6 && activeMultGlowInBar && activeMultGlowClip && pgUi('mult-glow')"
        class="layer z-mult-glow-mask"
        :style="pctLayerStyle(activeMultGlowClip)"
      >
        <div class="mult-glow-inner" :style="pctLayerStyle(activeMultGlowInBar)">
          <img class="mult-glow-img" :src="pgUi('mult-glow')!" alt="" />
        </div>
      </div>

      <!-- ⑥b 倍数指示牌：未激活暗刻贴图（import__0b tex0）+ 激活金色 ×（mult atlas） -->
      <template v-if="pgStep >= 6">
        <template v-for="(slot, idx) in multSlots" :key="slot.activeKey">
          <div
            v-if="activeMultiplierIndex !== idx && multInactiveUrl(slot)"
            class="layer z-mult-slot z-mult-slot--inactive"
            :style="pctLayerStyle(slot.darkBox)"
          >
            <img class="mult-slot-img mult-slot-img--inactive" :src="multInactiveUrl(slot)!" alt="" />
          </div>
          <div
            v-if="activeMultiplierIndex === idx && pgUi(slot.activeKey)"
            class="layer z-mult-slot z-mult-slot--active"
            :style="pctLayerStyle(slot.activeBox)"
          >
            <img
              class="mult-slot-img mult-slot-img--active"
              :class="{ 'is-pulsing': multPulseActive }"
              :src="pgUi(slot.activeKey)!"
              alt=""
            />
          </div>
        </template>
      </template>

      <!-- ④a 1024 橙条 main_top_b（叠在木纹倍数底上方） -->
      <div
        v-if="pgStep >= 4 && topBarMainUrl && L.topBarMain"
        class="layer z-top-bar-main"
        :style="pctLayerStyle(L.topBarMain)"
      >
        <img class="layer-img" :src="topBarMainUrl" alt="" />
      </div>

      <!-- ⑤ 1024 路中奖组合 -->
      <div
        v-if="pgStep >= 5 && pgUi('top-title-1024') && L.title1024"
        class="layer z-title1024-layer"
        :style="pctLayerStyle(L.title1024)"
      >
        <img class="title-1024-img" :src="pgUi('top-title-1024')!" alt="" />
      </div>

      <svg style="width:0;height:0;position:absolute;" aria-hidden="true" focusable="false">
        <defs>
          <filter id="carve-effect" color-interpolation-filters="sRGB">
            <!-- 获取透明度 -->
            <feComponentTransfer in="SourceAlpha" result="alpha">
              <feFuncA type="linear" slope="1"/>
            </feComponentTransfer>

            <!-- 内部阴影 (刻痕左上侧) -->
            <feGaussianBlur in="alpha" stdDeviation="1.2" result="blur_inner_shadow"/>
            <feOffset in="blur_inner_shadow" dx="1.5" dy="1.5" result="offset_inner_shadow"/>
            <feComposite in="alpha" in2="offset_inner_shadow" operator="out" result="inner_shadow_shape"/>
            <feFlood flood-color="#000000" flood-opacity="0.9" result="dark_color"/>
            <feComposite in="dark_color" in2="inner_shadow_shape" operator="in" result="inner_shadow"/>

            <!-- 内部高光 (刻痕右下侧) -->
            <feGaussianBlur in="alpha" stdDeviation="0.8" result="blur_inner_highlight"/>
            <feOffset in="blur_inner_highlight" dx="-1.5" dy="-1.5" result="offset_inner_highlight"/>
            <feComposite in="alpha" in2="offset_inner_highlight" operator="out" result="inner_highlight_shape"/>
            <feFlood flood-color="#ffffff" flood-opacity="0.6" result="light_color"/>
            <feComposite in="light_color" in2="inner_highlight_shape" operator="in" result="inner_highlight"/>

            <!-- 原图压暗加深 -->
            <feComponentTransfer in="SourceGraphic" result="darkened_source">
              <feFuncR type="linear" slope="0.7"/>
              <feFuncG type="linear" slope="0.7"/>
              <feFuncB type="linear" slope="0.7"/>
            </feComponentTransfer>

            <!-- 外部高光 (雕刻边缘右下侧受光) -->
            <feGaussianBlur in="alpha" stdDeviation="0.5" result="blur_outer"/>
            <feOffset in="blur_outer" dx="1" dy="1" result="offset_outer"/>
            <feComposite in="offset_outer" in2="alpha" operator="out" result="outer_highlight_shape"/>
            <feFlood flood-color="#ffffff" flood-opacity="0.8" result="outer_light_color"/>
            <feComposite in="outer_light_color" in2="outer_highlight_shape" operator="in" result="outer_highlight"/>

            <!-- 合并 -->
            <feMerge>
              <feMergeNode in="outer_highlight"/>
              <feMergeNode in="darkened_source"/>
              <feMergeNode in="inner_shadow"/>
              <feMergeNode in="inner_highlight"/>
            </feMerge>
          </filter>
        </defs>
      </svg>

      <!-- ①b 麻将牌 -->
      <div v-if="pgStep >= 7" class="layer-board game-board-area z-board" :style="boardStyle">
        <div id="grid-container" class="grid-container" :class="{ 'is-shaking': boardShaking }">

          <div
            class="grid-col"
            v-for="(_, colIndex) in COLS"
            :key="colIndex"
            :class="{ 'is-spinning-col': columnSpinning[colIndex] }"
          >
            <div
              class="col-inner"
              :class="{
                'is-spinning': columnSpinning[colIndex],
                'is-reel-bounce': columnReelBounce[colIndex],
                'is-turbo': isTurbo,
              }"
              :style="columnSpinning[colIndex] ? columnSpinStyle(colIndex) : undefined"
              @animationend="onColAnimationEnd(colIndex, $event)"
            >
              <MahjongTile
                v-for="(tile, rowIndex) in (columnSpinning[colIndex] ? spinningCols[colIndex] : gridData[colIndex])"
                :key="`${colIndex}-${rowIndex}-${tile.symbol}-${tile.isGolden ? 'g' : 'n'}`"
                :id="!columnSpinning[colIndex] && isVisibleRow(rowIndex) ? `tile-${colIndex}-${rowIndex}` : undefined"
                :symbol="tile.symbol"
                :is-golden="tile.isGolden"
                :is-winning="winningCells.has(`${colIndex}-${rowIndex}`)"
                :is-scatter-celebrating="scatterCelebratingCells.has(`${colIndex}-${rowIndex}`)"
                :is-exploding="explodingCells.has(`${colIndex}-${rowIndex}`)"
                :is-transforming="transformingCells.has(`${colIndex}-${rowIndex}`)"
                :fall-rows="tileDropMotions.get(`${colIndex}-${rowIndex}`)?.fallRows ?? 0"
                :fall-delay-ms="tileDropMotions.get(`${colIndex}-${rowIndex}`)?.delayMs ?? 0"
                :is-turbo="isTurbo"
                :asset-base="symbolAssetBase"
                :clickable="canClickTiles && isVisibleRow(rowIndex)"
                :is-selected="isTileSelected(colIndex, rowIndex)"
                @click="onTileClick(colIndex, rowIndex)"
              />
            </div>
          </div>

          <MahjongSymbolInfo
            :symbol="selectedTile?.symbol ?? null"
            :is-golden="selectedTile?.isGolden ?? false"
            :anchor="selectedTileAnchor"
            :asset-base="symbolAssetBase"
            :bg-image="activeBgUrl ?? ''"
          />

          <Transition name="retrigger-banner">
            <div
              v-if="retriggerBannerCount > 0"
              class="fs-retrigger-board-banner"
              aria-live="polite"
            >
              <span class="fs-retrigger-board-banner__inner">
                <span class="fs-retrigger-board-banner__plus">+</span>
                <span class="fs-retrigger-board-banner__num">{{ retriggerBannerCount }}</span>
                <span class="fs-retrigger-board-banner__label">次免费旋转</span>
              </span>
            </div>
          </Transition>
        </div>
      </div>

      <!-- ⑥ 三格金额框 -->
      <div v-if="pgStep >= 9" class="layer layer-hud z-hud" :style="pctLayerStyle(L.statusHud)">
        <div class="layer-hud__values">
          <!-- 余额面板 -->
          <div class="hud-panel hud-panel--balance clickable" @click="togglePopup('wallet')">
            <img class="hud-icon-img" :src="pgUi('icon-wallet-open')!" alt="" draggable="false" />
            <span class="hud-value">¥{{ fmtAmt(balance) }}</span>
          </div>
          <!-- 投注面板 -->
          <div
            class="hud-panel hud-panel--bet clickable"
            :class="{ 'is-disabled': !canAdjustBet }"
            @click="canAdjustBet && togglePopup('bet')"
          >
            <img class="hud-icon-img" :src="pgUi('icon-bet')!" alt="" draggable="false" />
            <span class="hud-value">¥{{ fmtAmt(hudBetDisplay) }}</span>
          </div>
          <!-- 赢取面板 -->
          <div class="hud-panel hud-panel--win clickable" @click="togglePopup('win')">
            <img class="hud-icon-img" :src="pgUi('icon-win')!" alt="" draggable="false" />
            <span class="hud-value" :class="{ 'is-win': hudWinDisplay > 0 }">¥{{ fmtAmt(hudWinDisplay) }}</span>
          </div>
        </div>
      </div>

      <!-- 免费旋转触发弹窗 -->
      <MahjongFreeSpinTriggerOverlay
        :visible="freeSpinTriggerVisible"
        :spins-awarded="freeSpinTriggerData?.spinsAwarded ?? 12"
        :is-retrigger="freeSpinTriggerData?.isRetrigger ?? false"
        :canvas-height="gameRenderHeight"
        :title-img="pgUi('fs-trigger-title') ?? ''"
        :subtitle-img="pgUi('fs-trigger-subtitle') ?? ''"
        :btn-start="pgUi('btn-start') ?? ''"
        :btn-start-pressed="pgUi('btn-start-pressed') ?? ''"
        :bg-gradient="pgUi('fs-trigger-bg-gradient') ?? ''"
        :bg-rays="pgUi('fs-trigger-bg-rays') ?? ''"
        :bg-tiles="pgUi('fs-trigger-bg-tiles') ?? ''"
        :bg-coins="pgUi('fs-trigger-bg-coins') ?? ''"
        :digits-atlas="pgUi('win-digits') ?? ''"
        :auto-dismiss-ms="isFsUiPreview ? 0 : 3200"
        @confirm="dismissFreeSpinTrigger"
      />

      <!-- 免费旋转结束总结 -->
      <MahjongFreeSpinEndOverlay
        :visible="freeSpinEndVisible"
        :total-win="freeSpinEndSnapshot.totalWin"
        :canvas-height="gameRenderHeight"
        :canvas-width="gameRenderWidth"
        :title-img="pgUi('fs-end-title') ?? ''"
        :btn-collect="pgUi('fs-end-collect') ?? ''"
        :btn-collect-pressed="pgUi('fs-end-collect-pressed') ?? ''"
        :bg-total="pgUi('fs-end-bg-total') ?? ''"
        :bg-glow-top="pgUi('fs-end-bg-glow-top') ?? ''"
        :bg-glow-bottom="pgUi('fs-end-bg-glow-bottom') ?? ''"
        :bg-flare="pgUi('fs-end-bg-flare') ?? ''"
        :bg-fg="pgUi('fs-end-bg-fg') ?? ''"
        :digits-atlas="pgUi('win-digits') ?? ''"
        :digit-dot="pgUi('win-digit-dot') ?? ''"
        :digit-comma="pgUi('win-digit-comma') ?? ''"
        :auto-dismiss-ms="isFsUiPreview ? 0 : 4800"
        @confirm="dismissFreeSpinEndSummary"
      />

      <!-- 开发：JSON 布局对照框（Alt+L 开关） -->
      <div v-if="layoutDebug" class="layout-debug" aria-hidden="true">
        <div
          v-for="region in layoutDebugRegions"
          :key="region.key"
          class="layout-debug__box"
          :class="`layout-debug__box--${region.key}`"
          :style="pctLayerStyle(region.box)"
        >
          <span class="layout-debug__label">{{ region.label }}</span>
        </div>
      </div>

      <!-- 交互层：按钮（坐标来自 Cocos dump worldPct） -->
      <div v-if="pgStep >= 10" class="btn-interactive-layer z-buttons">
        <Transition name="slide-left-page">
          <div class="bottom-action-bar" v-if="!showMenuPage && !showFsBottomPanel">
            <!-- 正版分层：深色圆底 + 琥珀色前景图标（worldPct 来自 Cocos dump） -->
            <img
              v-for="layer in bottomBtnCircles"
              :key="layer.key"
              class="pg-btn-circle"
              :class="{ 'is-visible': pressedBtn === layer.key }"
              :style="pctLayerStyle(layer.box)"
              :src="pgUi('btn-circle')!"
              alt=""
              draggable="false"
            />
            <template v-if="isTurbo">
              <div
                class="turbo-fx turbo-fx--glow"
                :style="turboFxStyle(turboFxVisuals.glow, 'turbo-fx-glow')"
                aria-hidden="true"
              />
            </template>
            <img
              class="pg-btn-label"
              :class="{ 'is-active': isTurbo }"
              :style="pctLayerStyle(bottomBtnVisuals.turbo)"
              :src="pgUi(isTurbo ? 'label-turbo-on' : 'label-turbo-off-ring')!"
              alt=""
              draggable="false"
            />
            <img
              class="pg-btn-tint turbo-center-icon"
              :class="{ 'is-active': isTurbo, 'is-flashing': isTurbo }"
              :style="pctLayerStyle(bottomBtnVisuals.turbo)"
              :src="pgUi(isTurbo ? 'btn-turbo-on' : 'btn-turbo')!"
              alt=""
              draggable="false"
            />
            <img
              class="pg-btn-tint"
              :style="pctLayerStyle(bottomBtnVisuals.minus)"
              :src="pgUi('btn-minus')!"
              alt=""
              draggable="false"
            />
            <img
              class="pg-btn-tint"
              :style="pctLayerStyle(bottomBtnVisuals.plus)"
              :src="pgUi('btn-plus')!"
              alt=""
              draggable="false"
            />
            <img
              class="pg-btn-label"
              :class="{ 'is-active': autoSpinCount > 0 }"
              :style="pctLayerStyle(bottomBtnVisuals.auto)"
              :src="pgUi('label-auto-text')!"
              alt=""
              draggable="false"
            />
            <img
              class="pg-btn-tint"
              :class="{ 'is-active': autoSpinCount > 0 }"
              :style="pctLayerStyle(bottomBtnVisuals.auto)"
              :src="pgUi('btn-auto-center')!"
              alt=""
              draggable="false"
            />
            <img
              class="pg-btn-tint"
              :style="pctLayerStyle(bottomBtnVisuals.menu)"
              :src="pgUi('btn-menu')!"
              alt=""
              draggable="false"
            />

            <button
              class="action-btn action-btn--hit action-btn--turbo"
              :class="{ 'is-active': isTurbo }"
              :style="pctLayerStyle(bottomBtnHits.turbo)"
              @pointerdown="setPressedBtn('turbo')"
              @pointerup="clearPressedBtn"
              @pointerleave="clearPressedBtn"
              @pointercancel="clearPressedBtn"
              @click="toggleTurbo"
            />
            <button
              class="action-btn action-btn--hit action-btn--minus"
              :class="{ 'is-disabled': !canAdjustBet }"
              :disabled="!canAdjustBet"
              :style="pctLayerStyle(bottomBtnHits.minus)"
              @pointerdown="setPressedBtn('minus')"
              @pointerup="clearPressedBtn"
              @pointerleave="clearPressedBtn"
              @pointercancel="clearPressedBtn"
              @click="decreaseBet"
            />
            <!-- 正版旋转钮：pgSpinLayout normal_spin_holder 子节点相对定位 -->
            <div
              class="spin-button-stack"
              :class="{ 'is-disabled': isSpinControlDisabled }"
              :style="pctLayerStyle(spinHolderBox)"
            >
              <img
                v-if="!showCenterSpinCount && pgUi('btn-spin-frame')"
                class="spin-stack-img spin-stack-disc"
                :class="{ 'is-free-spin': isFreeSpinMode }"
                :style="relPctStyle(pgSpin.disc)"
                :src="pgUi('btn-spin-frame')!"
                alt=""
                draggable="false"
              />
              <template v-else-if="showCenterSpinCount && pgUi('btn-spin-count')">
                <img
                  class="spin-stack-img spin-stack-disc--count"
                  :style="relPctStyle(pgSpin.countDisc)"
                  :src="pgUi('btn-spin-count')!"
                  alt=""
                  draggable="false"
                />
                <div
                  class="spin-stack-digits"
                  :class="{ 'is-count-bump': spinCountBumpActive }"
                  :style="relPctStyle(pgSpin.countDigits)"
                  aria-hidden="true"
                >
                  <span
                    v-for="(ch, i) in spinCountChars"
                    :key="`${spinCountBumpToken}-${i}-${ch}`"
                    class="spin-count-digit"
                    :style="spinCountDigitStyle(ch)"
                  />
                </div>
              </template>
              <div
                class="spin-stack-arrow"
                :style="relPctStyle(pgSpin.arrow)"
              >
                <MahjongSpinButton
                  :is-accelerating="isSpinning || isResolving"
                  :is-turbo="isTurbo"
                  :show-arrows="!showCenterSpinCount"
                  :retrigger-flash="spinRetriggerFlash"
                  :disabled="isSpinControlDisabled"
                />
              </div>
            </div>
            <button
              class="action-btn action-btn--hit action-btn--spin-hit"
              :class="{ 'is-disabled': isSpinControlDisabled }"
              :disabled="isSpinControlDisabled"
              :style="pctLayerStyle(pgSpin.hit)"
              aria-label="旋转"
              @click="handleSpinClick()"
            />
            <button
              class="action-btn action-btn--hit action-btn--plus"
              :class="{ 'is-disabled': !canAdjustBet }"
              :disabled="!canAdjustBet"
              :style="pctLayerStyle(bottomBtnHits.plus)"
              @pointerdown="setPressedBtn('plus')"
              @pointerup="clearPressedBtn"
              @pointerleave="clearPressedBtn"
              @pointercancel="clearPressedBtn"
              @click="increaseBet"
            />
            <button
              class="action-btn action-btn--hit action-btn--auto"
              :class="{ 'is-active': autoSpinCount > 0, 'is-disabled': !canUseAutoSpin && autoSpinCount === 0 }"
              :disabled="!canUseAutoSpin && autoSpinCount === 0"
              :style="pctLayerStyle(bottomBtnHits.auto)"
              @pointerdown="setPressedBtn('auto')"
              @pointerup="clearPressedBtn"
              @pointerleave="clearPressedBtn"
              @pointercancel="clearPressedBtn"
              @click="handleAutoBtnClick"
            >
              <div v-if="autoSpinCount > 0 && !showCenterSpinCount" class="auto-count-badge">{{ autoSpinCount }}</div>
            </button>
            <button
              class="action-btn action-btn--hit action-btn--menu"
              :style="pctLayerStyle(bottomBtnHits.menu)"
              aria-label="菜单"
              @pointerdown="setPressedBtn('menu')"
              @pointerup="clearPressedBtn"
              @pointerleave="clearPressedBtn"
              @pointercancel="clearPressedBtn"
              @click="showMenuPage = true"
            />
          </div>
        </Transition>

        <!-- 免费旋转底栏：正版替换全部底栏按钮 -->
        <div
          v-if="showFsBottomPanel"
          class="fs-bottom-panel"
          :style="pctLayerStyle(fsBottomLayout.panel)"
        >
          <img
            v-if="isLastFreeSpinLabel && pgUi('fs-last-spin-label')"
            class="fs-bottom-last"
            :src="pgUi('fs-last-spin-label')!"
            alt="最后免费旋转"
            draggable="false"
          />
          <div v-else class="fs-bottom-remaining">
            <div class="fs-bottom-remaining__label">
              <img
                v-if="pgUi('fs-remaining-label-top')"
                class="fs-remaining-line fs-remaining-line--top"
                :src="pgUi('fs-remaining-label-top')!"
                alt=""
                draggable="false"
              />
              <img
                v-if="pgUi('fs-remaining-label-bottom')"
                class="fs-remaining-line fs-remaining-line--bottom"
                :src="pgUi('fs-remaining-label-bottom')!"
                alt=""
                draggable="false"
              />
            </div>
            <img
              v-if="pgUi('fs-remaining-colon')"
              class="fs-remaining-colon"
              :src="pgUi('fs-remaining-colon')!"
              alt=""
              draggable="false"
            />
            <div
              class="fs-bottom-remaining__digits"
              :class="{ 'is-count-bump': fsCountBumpActive }"
              aria-hidden="true"
            >
              <span
                v-for="(ch, i) in fsCountChars"
                :key="`${fsCountBumpToken}-${i}-${ch}`"
                class="fs-count-digit"
                :style="fsCountDigitStyle(ch)"
              />
            </div>
          </div>
        </div>

        <Transition name="slide-right-page">
          <div class="bottom-action-menu-page" v-if="showMenuPage">
            <template v-for="item in menuPageLayers" :key="item.key">
              <img
                class="pg-btn-circle"
                :class="{ 'is-visible': pressedMenuBtn === item.key }"
                :style="pctLayerStyle(item.circle)"
                :src="pgUi('btn-circle')!"
                alt=""
                draggable="false"
              />
              <img
                class="pg-btn-tint menu-page-icon"
                :style="pctLayerStyle(item.icon)"
                :src="pgUi(item.iconKey)!"
                alt=""
                draggable="false"
              />
              <span class="menu-page-label" :style="pctLayerStyle(item.label)">{{ item.labelText }}</span>
              <button
                class="menu-page-hit"
                :style="pctLayerStyle(item.hit)"
                @pointerdown="setPressedMenuBtn(item.key)"
                @pointerup="clearPressedMenuBtn"
                @pointerleave="clearPressedMenuBtn"
                @pointercancel="clearPressedMenuBtn"
                @click="item.onClick()"
              />
            </template>
          </div>
        </Transition>
      </div>

      <MahjongInfoSheet
        :visible="infoSheetVisible"
        :initial-tab="infoSheetTab"
        :bet-amount="betAmount"
        @close="infoSheetVisible = false"
      />

      <!-- 弹窗遮罩 -->
      <Transition name="fade">
        <div
          v-if="activePopup"
          class="popup-backdrop"
          aria-hidden="true"
          @click="activePopup === 'bet' ? cancelBetPopup() : closePopup()"
        />
      </Transition>

      <!-- 底部上拉框 (点击金额格子弹出) -->
      <Transition name="slide-up">
        <div v-if="activePopup" class="hud-popup-drawer" :class="{ 'bet-popup-style': isSheetPopup }">
          
          <!-- 投注设置 -->
          <div v-if="activePopup === 'bet'" class="bet-settings-container">
            <div class="bet-sheet-handle" aria-hidden="true" />

            <div class="bet-popup-header">
              <span class="popup-title">投注设置</span>
              <button class="close-popup-btn" type="button" aria-label="关闭" @click="cancelBetPopup">×</button>
            </div>

            <div class="bet-balance-row">
              <span class="bet-balance-label">余额</span>
              <span class="bet-balance-value">¥{{ balance.toFixed(2) }}</span>
            </div>

            <div class="bet-total-pill">
              <span class="bet-total-pill__label">投注总额</span>
              <span class="bet-total-pill__value">{{ betAmount }} 点</span>
            </div>

            <div class="bet-table" :class="{ 'is-disabled': isBetPopupDisabled }">
              <div class="bet-thead">
                <div>投注大小</div>
                <div aria-hidden="true" />
                <div>投注倍数</div>
                <div aria-hidden="true" />
                <div>基础投注</div>
                <div aria-hidden="true" />
                <div>投注总额</div>
              </div>

              <div class="bet-picker-body">
                <div class="bet-highlight-row" aria-hidden="true" />

                <div class="bet-picker-col">
                  <div class="bet-wheel">
                    <button
                      v-for="offset in BET_WHEEL_OFFSETS"
                      :key="`size-${offset}`"
                      type="button"
                      class="bet-wheel-item"
                      :class="wheelItemClass(offset, currentSizeIdx, betSizes.length)"
                      :disabled="isBetPopupDisabled || !isWheelIndexValid(currentSizeIdx, offset, betSizes.length)"
                      @click="selectSizeByOffset(offset)"
                    >
                      {{ formatSizeWheelLabel(offset) }}
                    </button>
                  </div>
                </div>

                <div class="bet-separator-col">
                  <span v-for="offset in BET_WHEEL_OFFSETS" :key="`sep1-${offset}`" class="bet-sep-item">
                    {{ offset === 0 ? '×' : '' }}
                  </span>
                </div>

                <div class="bet-picker-col">
                  <div class="bet-wheel">
                    <button
                      v-for="offset in BET_WHEEL_OFFSETS"
                      :key="`mult-${offset}`"
                      type="button"
                      class="bet-wheel-item"
                      :class="wheelItemClass(offset, currentMultIdx, betMultipliers.length)"
                      :disabled="isBetPopupDisabled || !isWheelIndexValid(currentMultIdx, offset, betMultipliers.length)"
                      @click="selectMultByOffset(offset)"
                    >
                      {{ formatMultWheelLabel(offset) }}
                    </button>
                  </div>
                </div>

                <div class="bet-separator-col">
                  <span v-for="offset in BET_WHEEL_OFFSETS" :key="`sep2-${offset}`" class="bet-sep-item">
                    {{ offset === 0 ? '×' : '' }}
                  </span>
                </div>

                <div class="bet-picker-col bet-picker-col--static">
                  <div class="bet-wheel">
                    <span
                      v-for="offset in BET_WHEEL_OFFSETS"
                      :key="`base-${offset}`"
                      class="bet-wheel-item bet-wheel-item--readonly"
                      :class="wheelItemClass(offset, 0, 1)"
                    >
                      {{ offset === 0 ? baseBet : '' }}
                    </span>
                  </div>
                </div>

                <div class="bet-separator-col">
                  <span v-for="offset in BET_WHEEL_OFFSETS" :key="`sep3-${offset}`" class="bet-sep-item">
                    {{ offset === 0 ? '=' : '' }}
                  </span>
                </div>

                <div class="bet-picker-col bet-picker-col--total">
                  <div class="bet-wheel">
                    <button
                      v-for="offset in BET_WHEEL_OFFSETS"
                      :key="`total-${offset}`"
                      type="button"
                      class="bet-wheel-item bet-wheel-item--total"
                      :class="wheelItemClass(offset, currentTotalIdx, validTotals.length)"
                      :disabled="isBetPopupDisabled || !isWheelIndexValid(currentTotalIdx, offset, validTotals.length)"
                      @click="selectTotalByOffset(offset)"
                    >
                      {{ formatTotalWheelLabel(offset) }}
                    </button>
                  </div>
                </div>
              </div>
            </div>

            <div class="bet-quick-row">
              <button type="button" class="bet-quick-btn" :disabled="isBetPopupDisabled" @click="setMinBet">最小投注</button>
              <button type="button" class="bet-quick-btn bet-quick-btn--max" :disabled="isBetPopupDisabled" @click="setMaxBet">最大投注</button>
            </div>

            <div class="bet-popup-footer">
              <button type="button" class="cyber-btn cancel-btn" @click="cancelBetPopup">取 消</button>
              <button type="button" class="cyber-btn confirm-btn" @click="confirmBetPopup">确 定</button>
            </div>
          </div>

          <!-- 自动旋转设置弹窗 -->
          <div v-if="activePopup === 'auto'" class="bet-settings-container">
            <div class="bet-popup-header">
              <span class="popup-title">自动旋转</span>
              <button class="close-popup-btn" @click="closePopup">×</button>
            </div>
            
            <div class="auto-spin-section">
              <div class="auto-spin-label">自动旋转次数</div>
              <div class="auto-spin-options">
                <button 
                  v-for="opt in autoSpinOptions" 
                  :key="opt"
                  class="auto-opt-btn"
                  :class="{ 'is-selected': selectedAutoSpinCount === opt }"
                  @click="selectedAutoSpinCount = opt"
                >
                  {{ opt }}
                </button>
              </div>
            </div>

            <div class="bet-popup-footer" style="margin-top: 25px;">
              <button class="auto-start-btn" @click="startAutoSpin">开始自动旋转</button>
            </div>
          </div>
          <div v-if="activePopup === 'wallet'" class="hud-sheet-container">
            <div class="bet-sheet-handle" aria-hidden="true" />

            <div class="bet-popup-header">
              <span class="popup-title">账户余额</span>
              <button class="close-popup-btn" type="button" aria-label="关闭" @click="closePopup">×</button>
            </div>

            <div class="wallet-balance-pill">
              <img v-if="pgUi('icon-wallet')" class="wallet-pill-icon" :src="pgUi('icon-wallet')!" alt="" />
              <span class="wallet-pill-label">可用余额</span>
              <span class="wallet-pill-value">¥{{ balance.toFixed(2) }}</span>
            </div>

            <div class="wallet-stats-grid">
              <div class="wallet-stat-card">
                <span class="wallet-stat-label">{{ isInFreeSpinFeature ? '锁定投注' : '当前投注' }}</span>
                <span class="wallet-stat-value">¥{{ hudBetDisplay.toFixed(2) }}</span>
              </div>
              <div class="wallet-stat-card">
                <span class="wallet-stat-label">{{ isInFreeSpinFeature ? '免费累计' : '本局赢取' }}</span>
                <span class="wallet-stat-value" :class="{ 'is-win': hudWinDisplay > 0 }">¥{{ hudWinDisplay.toFixed(2) }}</span>
              </div>
            </div>

            <p class="wallet-hint">余额不足时无法开始旋转，请先调整投注或充值</p>
          </div>

          <!-- 赢取详情 -->
          <div v-if="activePopup === 'win'" class="hud-sheet-container win-sheet">
            <div class="bet-sheet-handle" aria-hidden="true" />

            <div class="bet-popup-header">
              <span class="popup-title">赢取详情</span>
              <button class="close-popup-btn" type="button" aria-label="关闭" @click="closePopup">×</button>
            </div>

            <div class="win-current-pill">
              <span class="win-current-pill__label">{{ isInFreeSpinFeature ? '本转赢取' : '本局赢取' }}</span>
              <span class="win-current-pill__value" :class="{ 'is-win': winAmount > 0 }">¥{{ winAmount.toFixed(2) }}</span>
            </div>

            <div v-if="isInFreeSpinFeature" class="win-current-pill win-session-pill">
              <span class="win-current-pill__label">免费累计</span>
              <span class="win-current-pill__value" :class="{ 'is-win': hudWinDisplay > 0 }">¥{{ hudWinDisplay.toFixed(2) }}</span>
            </div>

            <div class="win-stats-row">
              <div class="win-stat-item">
                <span class="win-stat-item__label">今日局数</span>
                <span class="win-stat-item__value">{{ winSummary.count }}</span>
              </div>
              <div class="win-stat-item">
                <span class="win-stat-item__label">盈利次数</span>
                <span class="win-stat-item__value">{{ winSummary.winCount }}</span>
              </div>
              <div class="win-stat-item">
                <span class="win-stat-item__label">累计盈利</span>
                <span class="win-stat-item__value" :class="winSummary.totalProfit >= 0 ? 'is-win' : 'is-lose'">
                  {{ winSummary.totalProfit >= 0 ? '+' : '' }}¥{{ winSummary.totalProfit.toFixed(2) }}
                </span>
              </div>
            </div>

            <div class="win-history-panel">
              <div class="win-history-head">
                <span>时间</span>
                <span>投注</span>
                <span>盈利</span>
              </div>
              <div v-if="historyRecords.length" class="win-history-body">
                <div
                  v-for="record in historyRecords.slice(0, 10)"
                  :key="record.id"
                  class="win-history-row"
                >
                  <span class="win-history-time">{{ record.time }}</span>
                  <span class="win-history-bet">¥{{ record.bet.toFixed(2) }}</span>
                  <span
                    class="win-history-profit"
                    :class="record.profit > 0 ? 'is-win' : record.profit < 0 ? 'is-lose' : 'is-neutral'"
                  >
                    {{ record.profit > 0 ? '+' : '' }}{{ record.profit.toFixed(2) }}
                  </span>
                </div>
              </div>
              <div v-else class="win-history-empty">暂无记录，开始旋转后这里会显示赢取详情</div>
            </div>

            <div class="bet-popup-footer win-sheet-footer">
              <button type="button" class="cyber-btn confirm-btn win-more-btn" @click="openFullHistory">查看全部记录</button>
            </div>
          </div>
        </div>
      </Transition>

      <!-- 历史记录全屏弹窗 -->
      <Transition name="fade">
        <div v-if="showHistoryModal" class="full-modal-overlay" @click.self="showHistoryModal = false">
          <div class="full-modal-content">
            <div class="modal-header">
              <span class="modal-title">今日记录</span>
              <button type="button" class="close-modal-btn" aria-label="关闭" @click="showHistoryModal = false">×</button>
            </div>

            <div class="modal-summary">
              <div class="modal-summary-item">
                <span>总局数</span>
                <strong>{{ winSummary.count }}</strong>
              </div>
              <div class="modal-summary-item">
                <span>累计盈利</span>
                <strong :class="winSummary.totalProfit >= 0 ? 'is-win' : 'is-lose'">
                  {{ winSummary.totalProfit >= 0 ? '+' : '' }}¥{{ winSummary.totalProfit.toFixed(2) }}
                </strong>
              </div>
            </div>

            <div class="modal-body">
              <table class="history-table">
                <thead>
                  <tr>
                    <th>时间</th>
                    <th>交易单号</th>
                    <th>投注</th>
                    <th>盈利</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="record in historyRecords" :key="record.id">
                    <td>{{ record.time }}</td>
                    <td class="txn-id">{{ record.id }}</td>
                    <td>¥{{ record.bet.toFixed(2) }}</td>
                    <td :class="record.profit > 0 ? 'is-win' : record.profit < 0 ? 'is-lose' : 'is-neutral'">
                      {{ record.profit > 0 ? '+' : '' }}{{ record.profit.toFixed(2) }}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </Transition>

      <!-- Big / Mega / Super Mega Win 庆祝 -->
      <Transition name="big-win">
        <div
          v-if="bigWinVisible"
          class="big-win-celebration"
          :class="`tier-${bigWinTier}`"
          aria-live="polite"
        >
          <img
            v-if="pgBigWinImage(bigWinTier)"
            class="big-win-banner"
            :src="pgBigWinImage(bigWinTier)!"
            alt=""
          />
          <template v-else>
            <div class="big-win-rays" aria-hidden="true" />
            <div class="big-win-sparkles" aria-hidden="true" />
            <div class="big-win-label">{{ bigWinLabel }}</div>
          </template>
          <div class="big-win-amount">¥{{ bigWinAmount.toFixed(2) }}</div>
        </div>
      </Transition>

    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick, onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import { useWalletStore } from '@/stores/wallet'
import { gamesApi } from '@/api/games'
import { useToast } from '@/composables/useToast'
import { useGameSpinSession } from '@/composables/useGameSpinSession'
import type { MahjongSpinResultDTO } from '@gamebox/shared'
import MahjongTile from '@/components/MahjongTile.vue'
import MahjongSymbolInfo, { type TileAnchor } from '@/components/MahjongSymbolInfo.vue'
import MahjongInfoSheet from '@/components/MahjongInfoSheet.vue'
import MahjongFreeSpinTriggerOverlay from '@/components/MahjongFreeSpinTriggerOverlay.vue'
import MahjongFreeSpinEndOverlay from '@/components/MahjongFreeSpinEndOverlay.vue'
import MahjongSpinButton from '@/components/MahjongSpinButton.vue'
import MahjongCover from '@/components/MahjongCover.vue'
import { MAHJONG_PG_VISUAL_STEP } from '@/games/mahjong/pgVisualStep'
import { useMahjongSound } from '@/composables/useMahjongSound'
import {
  BASE_BET,
  COLS,
  TOTAL_ROWS,
  VISIBLE_ROW_INDICES,
  type TileCell,
  type GridPos,
  type MahjongSymbolId,
  createEmptyGrid,
  getWinAnnounceSymbol,
  rollTile,
  computeTileDropMotions,
  freeSpinsFromScatters,
} from '@/games/mahjong/mahjongWays1'
import cocosLayout from '@/games/mahjong/cocosLayout.json'
import pgSpinLayout from '@/games/mahjong/pgSpinLayout.json'
import { hasPgUi, pgBigWinImage, pgUi } from '@/games/mahjong/pgAssets'
import { digitSpriteStyle } from '@/games/mahjong/digitAtlas'

type PctBox = {
  topPct: number
  heightPct: number
  leftPct: number
  widthPct: number
}

const router = useRouter()
const { toast } = useToast()
const spinSession = useGameSpinSession('mj')
const mahjongSound = useMahjongSound()
let componentDisposed = false
const symbolAssetBase = '/images/games/mahjong/pg/symbols'

/** 逐层复刻：URL ?step=3 可临时预览，否则读 pgVisualStep.ts */
const pgStep = computed(() => {
  const q = Number(router.currentRoute.value.query.step)
  if (Number.isFinite(q) && q >= 1 && q <= 10) return Math.floor(q)
  return MAHJONG_PG_VISUAL_STEP
})

const showPgCover = ref(false)
function onPgCoverStart() {
  showPgCover.value = false
  void mahjongSound.startMainBgm()
}

/** 正版 dump 设计稿 — 百分比坐标见 cocosLayout.json */
const CANVAS_W = cocosLayout.design[0]
const CANVAS_H = cocosLayout.design[1]

const canvasBoxStyle = computed(() => ({
  aspectRatio: `${CANVAS_W} / ${CANVAS_H}`,
  width: `min(100vw, 100vh * ${CANVAS_W / CANVAS_H})`,
  height: `min(100vh, 100vw * ${CANVAS_H / CANVAS_W})`,
}))
const L = cocosLayout.L as Record<string, PctBox>

/** 顶部两侧铜钱装饰（Cocos main_top_a） */
const topCoinsBarUrl = computed(() =>
  pgUi('top-coins-bar') ?? pgUi('wood-top-panel') ?? pgUi('wood-side-strip'),
)

const topBarMainUrl = computed(() =>
  pgUi('top-bar-main') ?? pgUi('top-bar-orange'),
)

const multBarFrameUrl = computed(() =>
  isInFreeSpinFeature.value
    ? (pgUi('multiplier-bar-bg-free') ?? pgUi('multiplier-bar-bg'))
    : (pgUi('multiplier-bar-bg') ?? pgUi('mult-bar-frame')),
)

type MultSlotLayout = {
  darkKey: string
  activeKey: string
  darkBox: PctBox
  activeBox: PctBox
  glowBox: PctBox
}

/** 正版 multiplier_glow：完整 117×55 贴图 scale×5，worldPct 来自 Cocos dump */
function glowBoxForActive(activeBox: PctBox): PctBox {
  const cx = activeBox.leftPct + activeBox.widthPct / 2
  const w = 54.167
  const h = 14.323
  const top = 0.328
  return {
    leftPct: cx - w / 2,
    topPct: top,
    widthPct: w,
    heightPct: h,
  }
}

function glowBoxInFrame(glow: PctBox, frame: PctBox): PctBox {
  return {
    leftPct: ((glow.leftPct - frame.leftPct) / frame.widthPct) * 100,
    topPct: ((glow.topPct - frame.topPct) / frame.heightPct) * 100,
    widthPct: (glow.widthPct / frame.widthPct) * 100,
    heightPct: (glow.heightPct / frame.heightPct) * 100,
  }
}

/** 正版只露出木条底边一条光带（非整条木纹高度） */
function glowClipFrame(frame: PctBox): PctBox {
  const stripH = frame.heightPct * 0.24
  return {
    leftPct: frame.leftPct,
    widthPct: frame.widthPct,
    topPct: frame.topPct + frame.heightPct - stripH,
    heightPct: stripH,
  }
}

const MULT_SLOTS_NORMAL: MultSlotLayout[] = [
  {
    darkKey: 'mult-x1-dark', activeKey: 'mult-x1',
    darkBox: { leftPct: 16.898, topPct: 9.266, widthPct: 10.593, heightPct: 4.692 },
    activeBox: { leftPct: 15.177, topPct: 8.052, widthPct: 14.035, heightPct: 6.48 },
    glowBox: { leftPct: 0, topPct: 0, widthPct: 0, heightPct: 0 },
  },
  {
    darkKey: 'mult-x2-dark', activeKey: 'mult-x2',
    darkBox: { leftPct: 34.442, topPct: 9.266, widthPct: 12.579, heightPct: 4.692 },
    activeBox: { leftPct: 33.052, topPct: 7.926, widthPct: 15.756, heightPct: 6.629 },
    glowBox: { leftPct: 0, topPct: 0, widthPct: 0, heightPct: 0 },
  },
  {
    darkKey: 'mult-x3-dark', activeKey: 'mult-x3',
    darkBox: { leftPct: 53.112, topPct: 9.192, widthPct: 12.314, heightPct: 4.767 },
    activeBox: { leftPct: 51.192, topPct: 7.926, widthPct: 16.154, heightPct: 6.703 },
    glowBox: { leftPct: 0, topPct: 0, widthPct: 0, heightPct: 0 },
  },
  {
    darkKey: 'mult-x5-dark', activeKey: 'mult-x5',
    darkBox: { leftPct: 71.715, topPct: 9.117, widthPct: 12.181, heightPct: 4.841 },
    activeBox: { leftPct: 69.861, topPct: 7.814, widthPct: 15.889, heightPct: 6.703 },
    glowBox: { leftPct: 0, topPct: 0, widthPct: 0, heightPct: 0 },
  },
]

const MULT_SLOTS_FREE: MultSlotLayout[] = [
  {
    darkKey: 'mult-x2-dark', activeKey: 'mult-x2',
    darkBox: { leftPct: 16.22, topPct: 9.345, widthPct: 11.95, heightPct: 4.458 },
    activeBox: { leftPct: 15.422, topPct: 8.283, widthPct: 14.181, heightPct: 5.966 },
    glowBox: { leftPct: 0, topPct: 0, widthPct: 0, heightPct: 0 },
  },
  {
    darkKey: 'mult-x4-dark', activeKey: 'mult-x4',
    darkBox: { leftPct: 34.757, topPct: 9.203, widthPct: 11.95, heightPct: 4.599 },
    activeBox: { leftPct: 33.343, topPct: 8.142, widthPct: 14.777, heightPct: 6.167 },
    glowBox: { leftPct: 0, topPct: 0, widthPct: 0, heightPct: 0 },
  },
  {
    darkKey: 'mult-x6-dark', activeKey: 'mult-x6',
    darkBox: { leftPct: 53.419, topPct: 9.274, widthPct: 11.698, heightPct: 4.528 },
    activeBox: { leftPct: 52.059, topPct: 8.209, widthPct: 14.419, heightPct: 6.1 },
    glowBox: { leftPct: 0, topPct: 0, widthPct: 0, heightPct: 0 },
  },
  {
    darkKey: 'mult-x10-dark', activeKey: 'mult-x10',
    darkBox: { leftPct: 69.629, topPct: 9.203, widthPct: 16.352, heightPct: 4.599 },
    activeBox: { leftPct: 68.153, topPct: 8.231, widthPct: 19.305, heightPct: 6.033 },
    glowBox: { leftPct: 0, topPct: 0, widthPct: 0, heightPct: 0 },
  },
]

const multSlots = computed(() =>
  (isInFreeSpinFeature.value ? MULT_SLOTS_FREE : MULT_SLOTS_NORMAL).map((slot) => ({
    ...slot,
    glowBox: glowBoxForActive(slot.activeBox),
  })),
)

/** 正版暗刻 ×：优先 mult-xN-dark，无资源时不硬叠 CSS 压暗 */
function multInactiveUrl(slot: MultSlotLayout): string | null {
  return pgUi(slot.darkKey) ?? pgUi(slot.activeKey)
}
const spinFrame = cocosLayout.spinFrame as PctBox
/** 正版旋转钮（pg-cocos-dump normal_spin_holder，1080×1920） */
const pgSpin = pgSpinLayout as {
  holder: PctBox
  countHolder: PctBox
  hit: PctBox
  disc: PctBox
  arrow: PctBox
  countDisc: PctBox
  countDigits: PctBox
}
const btnBar = cocosLayout.btnBar as PctBox

const bottomBtnHits = {
  turbo: { leftPct: 3.889, topPct: 83.906, widthPct: 16.667, heightPct: 9.375 },
  minus: { leftPct: 19.167, topPct: 83.438, widthPct: 16.667, heightPct: 10.313 },
  spin: pgSpin.hit,
  plus: { leftPct: 64.167, topPct: 83.438, widthPct: 16.667, heightPct: 10.313 },
  auto: { leftPct: 79.444, topPct: 83.906, widthPct: 16.667, heightPct: 9.375 },
  menu: { leftPct: 92.11, topPct: 83.906, widthPct: 18.076, heightPct: 9.375 },
} satisfies Record<string, PctBox>

const bottomBtnCircles = [
  { key: 'turbo', box: { leftPct: 3.889, topPct: 83.906, widthPct: 16.667, heightPct: 9.375 } },
  { key: 'minus', box: { leftPct: 19.167, topPct: 83.906, widthPct: 16.667, heightPct: 9.375 } },
  { key: 'plus', box: { leftPct: 64.167, topPct: 83.906, widthPct: 16.667, heightPct: 9.375 } },
  { key: 'auto', box: { leftPct: 79.444, topPct: 83.906, widthPct: 16.667, heightPct: 9.375 } },
  { key: 'menu', box: { leftPct: 93.519, topPct: 83.906, widthPct: 16.667, heightPct: 9.375 } },
] as const

const bottomBtnVisuals = {
  turbo: { leftPct: 8.056, topPct: 86.25, widthPct: 8.333, heightPct: 4.688 },
  minus: { leftPct: 22.5, topPct: 85.781, widthPct: 10, heightPct: 5.625 },
  plus: { leftPct: 67.5, topPct: 85.781, widthPct: 10, heightPct: 5.625 },
  auto: { leftPct: 83.611, topPct: 86.25, widthPct: 8.333, heightPct: 4.688 },
  menu: { leftPct: 94.151, topPct: 85.772, widthPct: 9.662, heightPct: 5.435 },
} satisfies Record<string, PctBox>

/** 极速开启光晕（Cocos dump worldPct） */
const turboFxVisuals = {
  glow: { leftPct: 9.907, topPct: 87.292, widthPct: 4.63, heightPct: 2.604 },
} satisfies Record<string, PctBox>

function turboFxStyle(box: PctBox, sheetKey: string) {
  const url = pgUi(sheetKey)
  return {
    ...pctLayerStyle(box),
    ...(url ? { backgroundImage: `url(${url})` } : {}),
  }
}

/** 菜单第二页：与主按钮行同高 */
const MENU_ROW = { circleTop: 83.906, circleH: 9.375, iconTop: 85.781, iconH: 5.625, labelTop: 90.989, labelH: 4.583 }
const menuPageLayers = computed(() => [
  {
    key: 'sound',
    hit: { leftPct: 4.056, topPct: MENU_ROW.circleTop, widthPct: 16.667, heightPct: MENU_ROW.circleH },
    circle: { leftPct: 4.056, topPct: MENU_ROW.circleTop, widthPct: 16.667, heightPct: MENU_ROW.circleH },
    icon: { leftPct: 7.389, topPct: MENU_ROW.iconTop, widthPct: 10, heightPct: MENU_ROW.iconH },
    label: { leftPct: 4.519, topPct: MENU_ROW.labelTop, widthPct: 15.741, heightPct: MENU_ROW.labelH },
    iconKey: soundEnabled.value ? 'btn-sound-on' : 'btn-sound-off',
    labelText: '声音',
    onClick: toggleSound,
  },
  {
    key: 'paytable',
    hit: { leftPct: 22.861, topPct: MENU_ROW.circleTop, widthPct: 16.667, heightPct: MENU_ROW.circleH },
    circle: { leftPct: 22.861, topPct: MENU_ROW.circleTop, widthPct: 16.667, heightPct: MENU_ROW.circleH },
    icon: { leftPct: 26.194, topPct: MENU_ROW.iconTop, widthPct: 10, heightPct: MENU_ROW.iconH },
    label: { leftPct: 23.324, topPct: MENU_ROW.labelTop, widthPct: 15.741, heightPct: MENU_ROW.labelH },
    iconKey: 'btn-paytable',
    labelText: '赔付表',
    onClick: () => openInfoSheet('pay'),
  },
  {
    key: 'rules',
    hit: { leftPct: 41.667, topPct: MENU_ROW.circleTop, widthPct: 16.667, heightPct: MENU_ROW.circleH },
    circle: { leftPct: 41.667, topPct: MENU_ROW.circleTop, widthPct: 16.667, heightPct: MENU_ROW.circleH },
    icon: { leftPct: 45, topPct: MENU_ROW.iconTop, widthPct: 10, heightPct: MENU_ROW.iconH },
    label: { leftPct: 42.13, topPct: MENU_ROW.labelTop, widthPct: 15.741, heightPct: MENU_ROW.labelH },
    iconKey: 'btn-rules',
    labelText: '规则',
    onClick: () => openInfoSheet('rules'),
  },
  {
    key: 'history',
    hit: { leftPct: 60.472, topPct: MENU_ROW.circleTop, widthPct: 16.667, heightPct: MENU_ROW.circleH },
    circle: { leftPct: 60.472, topPct: MENU_ROW.circleTop, widthPct: 16.667, heightPct: MENU_ROW.circleH },
    icon: { leftPct: 63.806, topPct: MENU_ROW.iconTop, widthPct: 10, heightPct: MENU_ROW.iconH },
    label: { leftPct: 60.935, topPct: MENU_ROW.labelTop, widthPct: 15.741, heightPct: MENU_ROW.labelH },
    iconKey: 'btn-history',
    labelText: '历史',
    onClick: () => { showHistoryModal.value = true },
  },
  {
    key: 'close',
    hit: { leftPct: 78.352, topPct: MENU_ROW.circleTop, widthPct: 18.519, heightPct: MENU_ROW.circleH },
    circle: { leftPct: 78.352, topPct: MENU_ROW.circleTop, widthPct: 18.519, heightPct: MENU_ROW.circleH },
    icon: { leftPct: 82.611, topPct: MENU_ROW.iconTop, widthPct: 10, heightPct: MENU_ROW.iconH },
    label: { leftPct: 78.352, topPct: MENU_ROW.labelTop, widthPct: 18.519, heightPct: MENU_ROW.labelH },
    iconKey: 'btn-back',
    labelText: '关闭',
    onClick: () => { showMenuPage.value = false },
  },
])

const bgImage = (cocosLayout as { bgImage?: PctBox }).bgImage ?? {
  topPct: 0,
  leftPct: 0,
  widthPct: 100,
  heightPct: 100,
}
const playReels = (cocosLayout as { playReels?: PctBox }).playReels ?? L.board

const layoutDebug = ref(false)

const layoutDebugRegions = computed(() => {
  const items: { key: string; label: string; box: PctBox }[] = [
    { key: 'bg', label: '底图 bg-base', box: bgImage },
    { key: 'woodTop', label: '钱币底图 main_top_a', box: L.woodTop },
    { key: 'topBarMain', label: '1024橙条 main_top_b', box: L.topBarMain },
    { key: 'multBarFrame', label: '倍数底框 main_top_c', box: L.multBarFrame },
    { key: 'title1024', label: '1024标题', box: L.title1024 },
    { key: 'reelFrame', label: '牌框 reel_a', box: L.reelFrame },
    { key: 'board', label: '牌区 reel_a', box: L.board },
    { key: 'playReels', label: '转轴 dark_reel', box: playReels },
    { key: 'message', label: '广告条 message', box: L.message },
    { key: 'bottomWood', label: '底栏木框', box: L.bottomWood },
    { key: 'statusHud', label: '三格金额', box: L.statusHud },
    { key: 'spinFrame', label: '旋转钮框(live)', box: spinFrame },
    { key: 'spinHolder', label: '旋转钮 holder', box: pgSpin.holder },
    { key: 'spinHit', label: '旋转热区', box: pgSpin.hit },
    { key: 'btnBar', label: '底栏按钮', box: btnBar },
  ]
  return items.filter((i) => i.box)
})

function pctLayerStyle(box: PctBox | undefined) {
  if (!box) return { display: 'none' }
  return {
    top: `${box.topPct}%`,
    height: `${box.heightPct}%`,
    left: `${box.leftPct}%`,
    width: `${box.widthPct}%`,
  }
}

/** spin-button-stack 内子层：相对父盒 0~100% */
function relPctStyle(box: PctBox) {
  return {
    left: `${box.leftPct}%`,
    top: `${box.topPct}%`,
    width: `${box.widthPct}%`,
    height: `${box.heightPct}%`,
  }
}

/** 牌区：正版 dark_reel 区域（与符号网格一致） */
const boardStyle = computed(() => pctLayerStyle(playReels))

const isVisibleRow = (row: number) =>
  (VISIBLE_ROW_INDICES as readonly number[]).includes(row)

/** 倍数档位仅驱动逻辑；高亮已烘焙在 bg-base 内，不再叠图层 */
// 中奖高亮与级联动画状态
const explodingCells = ref<Set<string>>(new Set())
const winningCells = ref<Set<string>>(new Set())
const transformingCells = ref<Set<string>>(new Set())
const tileDropMotions = ref(new Map<string, { fallRows: number; delayMs: number }>())
const isResolving = ref(false)

const CASCADE_ANIM = {
  normal: { win: 480, transform: 460, dissolve: 360, drop: 400, colStagger: 68 },
  turbo: { win: 240, transform: 230, dissolve: 185, drop: 210, colStagger: 34 },
} as const

/** PG 式逐列停轮：左→右依次落牌（与音效 scheduleReelStops 对齐） */
const REEL_STOP_DELAYS = {
  normal: [180, 360, 540, 720, 900],
  turbo: [60, 100, 140, 180, 220],
} as const

const REEL_BOUNCE_MS = { normal: 160, turbo: 90 } as const

/** 正版 slot_scroller 每列约 30 格，滚动段用 blur 符号条带 */
const REEL_BLUR_TILE_COUNT = 20

const columnSpinning = ref<boolean[]>(Array(COLS).fill(false))
const columnReelBounce = ref<boolean[]>(Array(COLS).fill(false))
const multPulseActive = ref(false)

const bigWinVisible = ref(false)
const bigWinTier = ref<'big' | 'mega' | 'super'>('big')
const bigWinAmount = ref(0)

const bigWinLabel = computed(() => {
  switch (bigWinTier.value) {
    case 'super':
      return 'SUPER MEGA WIN'
    case 'mega':
      return 'MEGA WIN'
    default:
      return 'BIG WIN'
  }
})

const columnSpinStyle = (colIndex: number) => {
  const delays = isTurbo.value ? REEL_STOP_DELAYS.turbo : REEL_STOP_DELAYS.normal
  return {
    '--reel-duration': `${delays[colIndex]}ms`,
    '--pg-blur-count': String(REEL_BLUR_TILE_COUNT),
  }
}

const onReelSpinEnd = (colIndex: number) => {
  if (!columnSpinning.value[colIndex]) return
  columnSpinning.value[colIndex] = false
  columnReelBounce.value[colIndex] = true
  gridData.value[colIndex] = spinningCols.value[colIndex]
    .slice(-TOTAL_ROWS)
    .map((t) => ({ ...t }))
  mahjongSound.playReelStop(colIndex, isTurbo.value)
  const bounceMs = isTurbo.value ? REEL_BOUNCE_MS.turbo : REEL_BOUNCE_MS.normal
  setTimeout(() => {
    columnReelBounce.value[colIndex] = false
  }, bounceMs)
}

const onColAnimationEnd = (colIndex: number, e: AnimationEvent) => {
  if (e.animationName !== 'slot-spin') return
  onReelSpinEnd(colIndex)
}

const showBigWinIfNeeded = async (totalWin: number) => {
  const bet = effectiveSpinBet.value || betAmount.value
  if (bet <= 0 || totalWin <= 0) return
  const mult = totalWin / bet
  let tier: 'big' | 'mega' | 'super' | null = null
  if (mult >= 100) tier = 'super'
  else if (mult >= 50) tier = 'mega'
  else if (mult >= 20) tier = 'big'
  if (!tier) return
  bigWinTier.value = tier
  bigWinAmount.value = totalWin
  bigWinVisible.value = true
  await sleep(isTurbo.value ? 1400 : 2600)
  bigWinVisible.value = false
}

// 自动旋转状态
const autoSpinCount = ref(0)
const selectedAutoSpinCount = ref(10)
const autoSpinOptions = [10, 30, 50, 80, 1000]

// 菜单页状态
const showMenuPage = ref(false)
const pressedBtn = ref<string | null>(null)
const pressedMenuBtn = ref<string | null>(null)

function setPressedBtn(key: string) {
  pressedBtn.value = key
}

function clearPressedBtn() {
  pressedBtn.value = null
}

function setPressedMenuBtn(key: string) {
  pressedMenuBtn.value = key
}

function clearPressedMenuBtn() {
  pressedMenuBtn.value = null
}

const soundEnabled = ref(localStorage.getItem('sound_off') !== '1')

const toggleSound = () => {
  soundEnabled.value = !soundEnabled.value
  if (soundEnabled.value) {
    localStorage.removeItem('sound_off')
  } else {
    localStorage.setItem('sound_off', '1')
  }
  mahjongSound.syncSoundEnabled()
}

const startAutoSpin = () => {
  if (!canUseAutoSpin.value) return
  autoSpinCount.value = selectedAutoSpinCount.value
  closePopup()
  if (!isSpinning.value) {
    handleSpinClick()
  }
}

const stopAutoSpin = () => {
  autoSpinCount.value = 0
}

const handleAutoBtnClick = () => {
  if (autoSpinCount.value > 0) {
    stopAutoSpin()
    return
  }
  if (!canUseAutoSpin.value) return
  togglePopup('auto')
}

const checkNextAutoSpin = () => {
  if (isFreeSpinMode.value && freeSpinsRemaining.value > 0) return
  if (autoSpinCount.value > 0) {
    autoSpinCount.value--
    if (autoSpinCount.value > 0 && balance.value >= betAmount.value) {
      spinSession.schedule(() => {
        void handleSpinClick()
      }, 500)
    } else {
      autoSpinCount.value = 0
    }
  }
}

// 赔付表 / 规则弹窗
const infoSheetVisible = ref(false)
const infoSheetTab = ref<'pay' | 'rules'>('pay')
const openInfoSheet = (tab: 'pay' | 'rules') => {
  infoSheetTab.value = tab
  infoSheetVisible.value = true
  showMenuPage.value = false
}

// 免费旋转（官方：3 胡 = 12 次，每多 1 个 +2）
const isFreeSpinMode = ref(false)
const freeSpinsRemaining = ref(0)
/** 触发免费旋转时锁定的投注额（整段免费功能共用） */
const freeSpinBetAmount = ref(0)
/** 当前免费旋转功能累计赢分（整段功能共用，供 HUD / 结束弹窗） */
const freeSpinSessionWin = ref(0)
/** 本段免费功能已完成的旋转次数 */
const freeSpinTotalSpinsPlayed = ref(0)
/** 当前这一转是否属于免费旋转（用于最后一转仍按 ×2~×10 结算） */
const isActiveFreeSpinSpin = ref(false)
const freeSpinTriggerVisible = ref(false)
const freeSpinTriggerData = ref<{
  scatterCount: number
  spinsAwarded: number
  isRetrigger: boolean
} | null>(null)
const freeSpinEndVisible = ref(false)
const freeSpinEndSnapshot = ref({ totalWin: 0, spinsPlayed: 0 })
const scatterCelebratingCells = ref(new Set<string>())
let freeSpinTriggerResolve: (() => void) | null = null
let freeSpinEndResolve: (() => void) | null = null
let freeSpinChainTimer: ReturnType<typeof setTimeout> | null = null
const spinCountBumpToken = ref(0)
const spinCountBumpActive = ref(false)
const spinRetriggerFlash = ref(0)
const freeSpinSessionId = ref<string | null>(null)
const serverAuthoritativeFreeSpin = ref(false)

/** 中间旋转钮计数：仅自动旋转（免费旋转走底栏替换面板） */
const centerSpinCount = computed(() => {
  if (autoSpinCount.value > 0) return autoSpinCount.value
  return 0
})

const showCenterSpinCount = computed(() => centerSpinCount.value > 0)

/** 免费旋转进行中：正版底栏替换（隐藏 turbo/±/旋转/自动/菜单） */
const showFsBottomPanel = computed(
  () =>
    isFreeSpinMode.value &&
    freeSpinsRemaining.value > 0 &&
    !freeSpinTriggerVisible.value &&
    !freeSpinEndVisible.value,
)

const isLastFreeSpinLabel = computed(() => freeSpinsRemaining.value === 1)

/** 正版 free_spins/zh 图集裁切，底栏居中区 */
const fsBottomLayout = {
  panel: { leftPct: 6, topPct: 74.2, widthPct: 88, heightPct: 9.2 },
} as const

const fsCountChars = computed(() => String(freeSpinsRemaining.value).split(''))
const fsCountBumpToken = ref(0)
const fsCountBumpActive = ref(false)

watch(freeSpinsRemaining, (next, prev) => {
  if (!showFsBottomPanel.value || next <= 1 || next === prev) return
  fsCountBumpToken.value++
  fsCountBumpActive.value = false
  requestAnimationFrame(() => {
    fsCountBumpActive.value = true
    setTimeout(() => {
      fsCountBumpActive.value = false
    }, 620)
  })
})

const fsCountDigitPx = computed(() =>
  Math.max(22, Math.round(gameRenderHeight.value * 5.6 / 100)),
)

function fsCountDigitStyle(digit: string): Record<string, string> {
  const atlas = pgUi('spin-count-digits') ?? pgUi('win-digits')
  const base = digitSpriteStyle(digit, fsCountDigitPx.value, atlas)
  if (!Object.keys(base).length) return {}
  return {
    ...base,
    filter: 'drop-shadow(0 2px 5px rgba(0, 0, 0, 0.6))',
  }
}

const spinHolderBox = computed(() =>
  showCenterSpinCount.value ? pgSpin.countHolder : pgSpin.holder,
)

function triggerSpinCountBump() {
  spinCountBumpToken.value++
  spinCountBumpActive.value = false
  requestAnimationFrame(() => {
    spinCountBumpActive.value = true
    setTimeout(() => {
      spinCountBumpActive.value = false
    }, 620)
  })
}

watch(centerSpinCount, (next, prev) => {
  if (next > 0 && next !== prev) triggerSpinCountBump()
})

const spinCountChars = computed(() => String(centerSpinCount.value).split(''))

const viewportSize = ref({
  w: typeof window !== 'undefined' ? window.innerWidth : CANVAS_W,
  h: typeof window !== 'undefined' ? window.innerHeight : CANVAS_H,
})

/** 画布实际渲染高度（与 canvasBoxStyle 一致） */
const gameRenderHeight = computed(() => {
  const { w, h } = viewportSize.value
  return Math.min(h, w * (CANVAS_H / CANVAS_W))
})

const gameRenderWidth = computed(() => {
  const { w, h } = viewportSize.value
  return Math.min(w, h * (CANVAS_W / CANVAS_H))
})

/** Cocos numberSprite heightPct 3.239 → 像素高度 */
const spinCountDigitPx = computed(() =>
  Math.max(16, Math.round(gameRenderHeight.value * 3.239 / 100)),
)

function spinCountDigitStyle(digit: string): Record<string, string> {
  const atlas = pgUi('spin-count-digits') ?? pgUi('win-digits')
  const base = digitSpriteStyle(digit, spinCountDigitPx.value, atlas)
  if (!Object.keys(base).length) return {}
  return {
    ...base,
    filter: 'drop-shadow(0 2px 4px rgba(0, 0, 0, 0.55))',
  }
}
const retriggerBannerCount = ref(0)
const boardShaking = ref(false)
let retriggerBannerTimer: ReturnType<typeof setTimeout> | null = null

const triggerBoardShake = () => {
  boardShaking.value = true
  setTimeout(() => {
    boardShaking.value = false
  }, isTurbo.value ? 220 : 380)
}

const showRetriggerBanner = (count: number) => {
  if (count <= 0) return
  if (retriggerBannerTimer) {
    clearTimeout(retriggerBannerTimer)
    retriggerBannerTimer = null
  }
  retriggerBannerCount.value = count
  retriggerBannerTimer = setTimeout(() => {
    retriggerBannerCount.value = 0
    retriggerBannerTimer = null
  }, 2800)
}

/** 开发预览：快捷键弹出免费旋转 UI，不影响真实对局数据 */
const isFsUiPreview = ref(false)

interface FsPreviewRestore {
  isFreeSpinMode: boolean
  freeSpinsRemaining: number
  freeSpinBetAmount: number
  freeSpinSessionWin: number
  freeSpinTotalSpinsPlayed: number
}

let fsPreviewRestore: FsPreviewRestore | null = null

const closeFsUiPreview = () => {
  if (!isFsUiPreview.value) return
  freeSpinTriggerVisible.value = false
  freeSpinEndVisible.value = false
  freeSpinTriggerData.value = null
  scatterCelebratingCells.value.clear()
  isFsUiPreview.value = false
  if (fsPreviewRestore) {
    isFreeSpinMode.value = fsPreviewRestore.isFreeSpinMode
    freeSpinsRemaining.value = fsPreviewRestore.freeSpinsRemaining
    freeSpinBetAmount.value = fsPreviewRestore.freeSpinBetAmount
    freeSpinSessionWin.value = fsPreviewRestore.freeSpinSessionWin
    freeSpinTotalSpinsPlayed.value = fsPreviewRestore.freeSpinTotalSpinsPlayed
    fsPreviewRestore = null
  }
}

const openFsUiPreview = (mode: 'trigger' | 'retrigger' | 'end') => {
  if (!import.meta.env.DEV) return
  closeFsUiPreview()
  closePopup()
  infoSheetVisible.value = false
  showHistoryModal.value = false
  showMenuPage.value = false
  clearFreeSpinChainTimer()

  fsPreviewRestore = {
    isFreeSpinMode: isFreeSpinMode.value,
    freeSpinsRemaining: freeSpinsRemaining.value,
    freeSpinBetAmount: freeSpinBetAmount.value,
    freeSpinSessionWin: freeSpinSessionWin.value,
    freeSpinTotalSpinsPlayed: freeSpinTotalSpinsPlayed.value,
  }
  isFsUiPreview.value = true

  if (mode === 'end') {
    isFreeSpinMode.value = true
    freeSpinBetAmount.value = betAmount.value
    freeSpinSessionWin.value = 8888.88
    freeSpinTotalSpinsPlayed.value = 12
    freeSpinsRemaining.value = 0
    freeSpinEndSnapshot.value = { totalWin: 8888.88, spinsPlayed: 12 }
    freeSpinEndVisible.value = true
    return
  }

  if (mode === 'retrigger') {
    isFreeSpinMode.value = true
    freeSpinsRemaining.value = 13
    freeSpinBetAmount.value = betAmount.value
    freeSpinSessionWin.value = 1288.5
    freeSpinTriggerData.value = {
      scatterCount: 5,
      spinsAwarded: 16,
      isRetrigger: true,
    }
    scatterCelebratingCells.value = new Set(['0-2', '1-3', '2-1', '3-4', '4-2'])
    showRetriggerBanner(16)
    triggerBoardShake()
  } else {
    enterFreeSpinFeature()
    freeSpinsRemaining.value = 0
    freeSpinTriggerData.value = {
      scatterCount: 3,
      spinsAwarded: 12,
      isRetrigger: false,
    }
  }
  freeSpinTriggerVisible.value = true
}

/** 开发：预览级联消除火焰 + 粒子（Alt+4） */
const previewCascadeFx = async () => {
  if (!import.meta.env.DEV) return
  if (isSpinning.value || isResolving.value) return
  const demoKeys = ['0-2', '1-2', '2-2', '3-2', '4-2', '1-3', '2-3', '3-3']
  await showWinHighlight(
    demoKeys.map((k) => {
      const [col, row] = k.split('-').map(Number)
      return { col: col!, row: row! }
    }),
    0,
  )
  explodingCells.value = new Set(demoKeys)
  triggerBoardShake()
  await sleep(isTurbo.value ? 200 : 380)
  explodingCells.value.clear()
  winningCells.value.clear()
}

const onFsPreviewKeydown = (event: KeyboardEvent) => {
  if (!import.meta.env.DEV) return
  if (!event.altKey || event.ctrlKey || event.metaKey) {
    if (event.key === 'Escape' && isFsUiPreview.value) {
      event.preventDefault()
      closeFsUiPreview()
    }
    return
  }
  if (event.key === '1') {
    event.preventDefault()
    openFsUiPreview('trigger')
  } else if (event.key === '2') {
    event.preventDefault()
    openFsUiPreview('retrigger')
  } else if (event.key === '3') {
    event.preventDefault()
    openFsUiPreview('end')
  } else if (event.key === '4') {
    event.preventDefault()
    previewCascadeFx()
  } else if (event.key === 'l' || event.key === 'L') {
    event.preventDefault()
    layoutDebug.value = !layoutDebug.value
  }
}

const clearFreeSpinChainTimer = () => {
  if (freeSpinChainTimer) {
    clearTimeout(freeSpinChainTimer)
    freeSpinChainTimer = null
  }
}

const scheduleNextFreeSpin = () => {
  clearFreeSpinChainTimer()
  freeSpinChainTimer = setTimeout(() => {
    freeSpinChainTimer = null
    handleSpinClick({ fromFreeSpinChain: true })
  }, isTurbo.value ? 400 : 800)
}

/** 整段免费功能进行中（含弹窗、最后一转间隙、结束总结） */
const isInFreeSpinFeature = computed(
  () =>
    isFreeSpinMode.value &&
    (freeSpinsRemaining.value > 0 ||
      isActiveFreeSpinSpin.value ||
      freeSpinTriggerVisible.value ||
      freeSpinEndVisible.value),
)

const hasFreeSpinBgAsset = computed(() => hasPgUi('multiplier-bar-bg-free'))

/** 全屏视口底图：专属封面2（#background-img / launch.jpg 同源） */
const pageBgUrl = computed(() => pgUi('cover-bottom-bg'))
/** 符号说明弹层仍用画布内 bg-base */
const symbolInfoBgUrl = computed(() => pgUi('bg-base'))
const activeBgUrl = computed(() => symbolInfoBgUrl.value)

/** 免费局由系统自动连转，按钮仅展示状态 */
const isFreeSpinAutoPlaying = computed(
  () =>
    isFreeSpinMode.value &&
    freeSpinsRemaining.value > 0 &&
    !isSpinning.value &&
    !isResolving.value &&
    !freeSpinTriggerVisible.value &&
    !freeSpinEndVisible.value,
)

const isSpinControlDisabled = computed(
  () =>
    isSpinning.value ||
    isResolving.value ||
    freeSpinTriggerVisible.value ||
    freeSpinEndVisible.value ||
    isFreeSpinAutoPlaying.value,
)

/** 免费旋转进行中不可改投注 */
const canAdjustBet = computed(
  () => !isInFreeSpinFeature.value && !isSpinning.value && !isResolving.value,
)

/** 免费旋转进行中不可开启自动旋转 */
const canUseAutoSpin = computed(
  () => !isInFreeSpinFeature.value && !isSpinning.value && !isResolving.value,
)

const hudBetDisplay = computed(() =>
  isInFreeSpinFeature.value && freeSpinBetAmount.value > 0
    ? freeSpinBetAmount.value
    : betAmount.value,
)

/** 格式化金额：千位分隔符 + 两位小数（如原版 ¥100,000.00） */
function fmtAmt(n: number): string {
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

/** 免费局 HUD 奖金：已完成转累计 + 当前转进行中的赢分 */
const hudWinDisplay = computed(() =>
  isInFreeSpinFeature.value
    ? freeSpinSessionWin.value + winAmount.value
    : winAmount.value,
)

/**
 * 信息栏框三档（对照 Cocos dump）：
 *   0 = 普通旋转 → normal_frontBoard (infoboard_a) 金框
 *       · win=0  → ticker 滚动（message/info2 active）
 *       · win>0  → 第1次连击「赢得 XX」，第2次起「共赢得 XX」
 *   1 = 免费旋转模式 → bonus_frontBoard (infoboard_b) 绿框
 *       · win>0  → 同上（连击标签逻辑一致）
 *   2 = 大赢（win ≥ 50×bet）→ medium_winboard (infoboard_c) 紫框
 *       · 覆盖在底框之上，标签随连击次数切换
 */
/** 将赢钱金额拆为字符数组（用于精灵数字渲染） */
const infoboardWinChars = computed(() => {
  const s = hudWinDisplay.value.toLocaleString('zh-CN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
  return s.split('')
})

/** 连击第 2 次起显示「共赢得」（单次旋转内） */
const infoboardWinIsTotal = ref(false)

/**
 * Cocos worldPct（相对整屏）：win_info 5.208% / numberSprite 4.156%，垂直中线对齐。
 */
const INFOBOARD_LABEL_H_PCT = 5.208
const INFOBOARD_DIGIT_H_PCT = 4.156
const INFOBOARD_WIN_SCALE = 0.9

const infoboardWinMetrics = computed(() => {
  const scale = INFOBOARD_WIN_SCALE
  const labelPx = Math.max(16, Math.round(gameRenderHeight.value * INFOBOARD_LABEL_H_PCT / 100 * scale))
  const digitPx = Math.max(14, Math.round(gameRenderHeight.value * INFOBOARD_DIGIT_H_PCT / 100 * scale))
  return { labelPx, digitPx }
})

const infoboardWinContentStyle = computed(() => ({
  '--win-label-h': `${infoboardWinMetrics.value.labelPx}px`,
  '--win-digit-h': `${infoboardWinMetrics.value.digitPx}px`,
}))

function winDigitClass(ch: string): string {
  if (ch === '.') return 'win-digit-dot'
  if (ch === ',') return 'win-digit-comma'
  return `win-digit-${ch}`
}

function winDigitStyle(digit: string): Record<string, string> {
  return digitSpriteStyle(
    digit,
    infoboardWinMetrics.value.digitPx,
    pgUi('win-digits'),
    pgUi('win-digit-dot'),
    pgUi('win-digit-comma'),
  )
}

const infoBoardStage = computed<0 | 1 | 2>(() => {
  // 大赢阈值：≥ 50 倍下注 → 紫框
  const win = hudWinDisplay.value
  const bet = hudBetDisplay.value
  if (win > 0 && bet > 0 && win >= bet * 50) return 2
  // 免费旋转模式 → 绿框
  if (isFreeSpinMode.value) return 1
  // 普通旋转 → 金框（win=0 ticker，win>0 赢钱）
  return 0
})

/** 普通模式 3 条轮播（正版 atlas PNG，含百搭/胡图标） */
const AD_MSGS = [
  { key: 'info2-msg1', imgW: 434, imgH: 62 },  // 赢得高达1024路！
  { key: 'info2-msg2', imgW: 724, imgH: 84 },  // 获得镀金符号，有机会赢得百搭
  { key: 'info2-msg3', imgW: 928, imgH: 74 },  // 3个或更多胡奖励12次或更多免费旋转
] as const
/** 免费旋转模式单条 */
const FS_MSG = { key: 'info2-msg4', imgW: 936, imgH: 72 } // 在免费旋转中，赢得高达10倍奖金倍数！

const currentAdMsgUrl = computed(() => {
  const key = isFreeSpinMode.value ? FS_MSG.key : AD_MSGS[adMsgIdx.value].key
  return pgUi(key)
})

const adMsgIdx = ref(0)
const adMsgAnimKey = ref(0)
const adMsgContainerRef = ref<HTMLElement | null>(null)
const adMsgIsFit = ref(true)
const adMsgScrollDur = ref('8s')

function refreshAdMsgState() {
  const el = adMsgContainerRef.value
  const containerW = el?.clientWidth ?? 411
  const containerH = el?.clientHeight ?? 38
  const msg = isFreeSpinMode.value ? FS_MSG : AD_MSGS[adMsgIdx.value]
  const displayW = (msg.imgW / msg.imgH) * containerH
  adMsgIsFit.value = displayW <= containerW
  adMsgScrollDur.value = `${(displayW / 70).toFixed(1)}s`
}

function onAdMsgAnimEnd() {
  if (!isFreeSpinMode.value) {
    adMsgIdx.value = (adMsgIdx.value + 1) % AD_MSGS.length
  }
  adMsgAnimKey.value++
  nextTick(refreshAdMsgState)
}

watch(isFreeSpinMode, () => {
  if (!isFreeSpinMode.value) adMsgIdx.value = 0
  adMsgAnimKey.value++
  nextTick(refreshAdMsgState)
})

const effectiveSpinBet = computed(() =>
  isActiveFreeSpinSpin.value && freeSpinBetAmount.value > 0
    ? freeSpinBetAmount.value
    : betAmount.value,
)

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/** PG 式中奖高亮：火焰脉冲 → 消除 */
const showWinHighlight = async (winCells: GridPos[], cascadeStep = 0) => {
  if (!winCells.length) return
  mahjongSound.playWin(
    cascadeStep,
    getWinAnnounceSymbol(gridData.value),
    isActiveFreeSpinSpin.value,
  )
  winningCells.value = new Set(winCells.map(({ col, row }) => `${col}-${row}`))
  triggerBoardShake()
  const timings = isTurbo.value ? CASCADE_ANIM.turbo : CASCADE_ANIM.normal
  await sleep(timings.win)
}

/** 首次 Scatter：立刻锁注并进入免费局 UI（弹窗叠在上面） */
const enterFreeSpinFeature = () => {
  if (isFreeSpinMode.value) return
  freeSpinBetAmount.value = betAmount.value
  freeSpinSessionWin.value = 0
  freeSpinTotalSpinsPlayed.value = 0
  autoSpinCount.value = 0
  activeMultiplierIndex.value = 0
  isFreeSpinMode.value = true
}

const addFreeSpinsFromTrigger = (scatterCount: number) => {
  const added = freeSpinsFromScatters(scatterCount)
  if (added <= 0) return 0
  freeSpinsRemaining.value += added
  return added
}

const dismissFreeSpinTrigger = () => {
  if (!freeSpinTriggerVisible.value) return
  const data = freeSpinTriggerData.value
  freeSpinTriggerVisible.value = false
  scatterCelebratingCells.value.clear()
  freeSpinTriggerData.value = null
  if (isFsUiPreview.value) {
    isFsUiPreview.value = false
    if (fsPreviewRestore) {
      isFreeSpinMode.value = fsPreviewRestore.isFreeSpinMode
      freeSpinsRemaining.value = fsPreviewRestore.freeSpinsRemaining
      freeSpinBetAmount.value = fsPreviewRestore.freeSpinBetAmount
      freeSpinSessionWin.value = fsPreviewRestore.freeSpinSessionWin
      freeSpinTotalSpinsPlayed.value = fsPreviewRestore.freeSpinTotalSpinsPlayed
      fsPreviewRestore = null
    }
    freeSpinTriggerResolve?.()
    freeSpinTriggerResolve = null
    return
  }
  if (data && !serverAuthoritativeFreeSpin.value) {
    const wasRetrigger = data.isRetrigger
    const added = addFreeSpinsFromTrigger(data.scatterCount)
    if (wasRetrigger && added > 0) {
      spinRetriggerFlash.value = added
      setTimeout(() => {
        spinRetriggerFlash.value = 0
      }, 900)
    }
  }
  serverAuthoritativeFreeSpin.value = false
  freeSpinTriggerResolve?.()
  freeSpinTriggerResolve = null
}

const showFreeSpinEndSummary = (): Promise<void> => {
  if (freeSpinEndVisible.value) return Promise.resolve()
  mahjongSound.playFreeSpinEnd()
  freeSpinEndSnapshot.value = {
    totalWin: freeSpinSessionWin.value,
    spinsPlayed: freeSpinTotalSpinsPlayed.value,
  }
  freeSpinEndVisible.value = true
  clearFreeSpinChainTimer()
  return new Promise((resolve) => {
    freeSpinEndResolve = resolve
  })
}

const dismissFreeSpinEndSummary = () => {
  if (!freeSpinEndVisible.value) return
  freeSpinEndVisible.value = false
  if (isFsUiPreview.value) {
    isFsUiPreview.value = false
    if (fsPreviewRestore) {
      isFreeSpinMode.value = fsPreviewRestore.isFreeSpinMode
      freeSpinsRemaining.value = fsPreviewRestore.freeSpinsRemaining
      freeSpinBetAmount.value = fsPreviewRestore.freeSpinBetAmount
      freeSpinSessionWin.value = fsPreviewRestore.freeSpinSessionWin
      freeSpinTotalSpinsPlayed.value = fsPreviewRestore.freeSpinTotalSpinsPlayed
      fsPreviewRestore = null
    }
    freeSpinEndResolve?.()
    freeSpinEndResolve = null
    return
  }
  finalizeFreeSpinSession()
  freeSpinEndResolve?.()
  freeSpinEndResolve = null
}

const finalizeFreeSpinSession = () => {
  isFreeSpinMode.value = false
  freeSpinBetAmount.value = 0
  freeSpinSessionWin.value = 0
  freeSpinTotalSpinsPlayed.value = 0
  freeSpinSessionId.value = null
  freeSpinsRemaining.value = 0
  clearFreeSpinChainTimer()
}

const applyServerFreeSpinState = (result: MahjongSpinResultDTO) => {
  const fs = result.freeSpin
  if (!fs) {
    if (result.spinType === 'FREE' && freeSpinsRemaining.value <= 0) {
      // 会话已在服务端结束，留给结束弹窗处理
    }
    return
  }
  freeSpinSessionId.value = fs.sessionId
  freeSpinsRemaining.value = fs.spinsRemaining
  freeSpinSessionWin.value = fs.sessionTotalWin
  freeSpinBetAmount.value = fs.lockedBetAmount
  if (fs.triggered || fs.retriggered || fs.spinsRemaining > 0) {
    isFreeSpinMode.value = true
  }
}

const finishRound = () => {
  historyRecords.value.unshift({
    id: currentRecordId.value,
    time: new Date().toLocaleTimeString('zh-CN', { hour12: false }),
    bet: isActiveFreeSpinSpin.value ? 0 : betAmount.value,
    profit: winAmount.value,
  })
  if (historyRecords.value.length > 50) historyRecords.value.length = 50
  checkNextAutoSpin()
}

/** 按服务端级联步骤回放动画，客户端不再本地算奖/补牌 */
const runCascadeResolution = async (result: MahjongSpinResultDTO) => {
  isResolving.value = true
  infoboardWinIsTotal.value = false
  winAmount.value = 0

  for (const step of result.cascades) {
    if (componentDisposed) return
    activeMultiplierIndex.value = Math.min(step.cascadeIndex, 3)
    infoboardWinIsTotal.value = step.cascadeIndex >= 1
    winAmount.value += step.stepWin
    if (isActiveFreeSpinSpin.value) {
      freeSpinSessionWin.value = Math.max(freeSpinSessionWin.value, result.freeSpin?.sessionTotalWin ?? freeSpinSessionWin.value)
    }

    const winCells = step.winCells as GridPos[]
    await showWinHighlight(winCells, step.cascadeIndex)

    const timings = isTurbo.value ? CASCADE_ANIM.turbo : CASCADE_ANIM.normal
    const toRemove = step.removeCells as GridPos[]
    const goldenKeys = step.goldenToWild.map(({ col, row }) => `${col}-${row}`)

    if (goldenKeys.length) {
      transformingCells.value = new Set(goldenKeys)
      const transformMid = Math.floor(timings.transform / 2)
      setTimeout(() => {
        for (const { col, row } of step.goldenToWild) {
          if (gridData.value[col]?.[row]) {
            gridData.value[col][row] = { symbol: 'wild', isGolden: false }
          }
        }
      }, transformMid)
      await sleep(timings.transform)
      transformingCells.value.clear()
    }

    explodingCells.value = new Set(toRemove.map(({ col, row }) => `${col}-${row}`))
    triggerBoardShake()
    await sleep(timings.dissolve)

    explodingCells.value.clear()
    winningCells.value.clear()

    const motions = computeTileDropMotions(toRemove, timings.colStagger)
    gridData.value = step.gridAfter.map((col) => col.map((t) => ({ ...t }))) as TileCell[][]
    tileDropMotions.value = motions
    await nextTick()

    const maxColDelay = (COLS - 1) * timings.colStagger
    await sleep(timings.drop + maxColDelay)
    tileDropMotions.value.clear()
  }

  winAmount.value = result.totalWin
  balance.value = result.balance
  walletStore.balance = result.balance
  applyServerFreeSpinState(result)

  await showBigWinIfNeeded(winAmount.value)

  isResolving.value = false
  finishRound()

  if (isActiveFreeSpinSpin.value) {
    isActiveFreeSpinSpin.value = false
    freeSpinTotalSpinsPlayed.value += 1
  }

  const fs = result.freeSpin
  if (fs?.triggered || fs?.retriggered) {
    serverAuthoritativeFreeSpin.value = true
    const scatterCount = fs.spinsAwarded <= 12 ? 3 : 3 + Math.floor((fs.spinsAwarded - 12) / 2)
    // 服务端已计入 spinsRemaining，弹窗只做展示，不再本地加次数
    const isRetrigger = Boolean(fs.retriggered)
    if (!isRetrigger) {
      enterFreeSpinFeature()
      freeSpinBetAmount.value = fs.lockedBetAmount
      mahjongSound.playFreeSpinEnter()
    }
    mahjongSound.playScatterTrigger(isRetrigger)
    freeSpinTriggerData.value = {
      scatterCount,
      spinsAwarded: fs.spinsAwarded,
      isRetrigger,
    }
    freeSpinTriggerVisible.value = true
    await new Promise<void>((resolve) => {
      freeSpinTriggerResolve = resolve
    })
  }

  if (isFreeSpinMode.value && freeSpinsRemaining.value <= 0) {
    await showFreeSpinEndSummary()
  } else if (
    isFreeSpinMode.value &&
    freeSpinsRemaining.value > 0 &&
    !freeSpinTriggerVisible.value &&
    !freeSpinEndVisible.value
  ) {
    scheduleNextFreeSpin()
  }
}

// 旋转状态
const isSpinning = ref(false)

// 极速模式状态
const isTurbo = ref(false)
const toggleTurbo = () => {
  if (isSpinning.value) return // 旋转中不允许切换
  isTurbo.value = !isTurbo.value
}

// 投注逻辑：只保留「size×mult×BASE_BET」为整数点的组合，UI 与账本一致
const betSizes = [0.01, 0.03, 0.1, 1.0, 5.0]
const betMultipliers = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
const baseBet = BASE_BET

const validCombinations: Array<{ sizeIdx: number; multIdx: number; total: number }> = []
for (let s = 0; s < betSizes.length; s++) {
  for (let m = 0; m < betMultipliers.length; m++) {
    const raw = betSizes[s]! * betMultipliers[m]! * baseBet
    const total = Math.round(raw)
    if (total < 1 || Math.abs(raw - total) > 1e-9) continue
    validCombinations.push({ sizeIdx: s, multIdx: m, total })
  }
}
validCombinations.sort((a, b) => a.total - b.total)
const validTotals = Array.from(new Set(validCombinations.map((c) => c.total))).sort(
  (a, b) => a - b,
)

/** 默认 0.10 × 1 × 20 = 2 点（整数，与扣款一致） */
const currentSizeIdx = ref(2)
const currentMultIdx = ref(0)

const betAmount = computed(() => {
  const raw =
    betSizes[currentSizeIdx.value]! * betMultipliers[currentMultIdx.value]! * baseBet
  return Math.round(raw)
})
const currentTotalIdx = computed(() => validTotals.indexOf(betAmount.value))

const BET_WHEEL_OFFSETS = [-2, -1, 0, 1, 2] as const
const betSnapshot = ref({ sizeIdx: 2, multIdx: 0 })
const isBetPopupDisabled = computed(() => isSpinning.value || isResolving.value || !canAdjustBet.value)

const isWheelIndexValid = (currentIdx: number, offset: number, length: number) => {
  const idx = currentIdx + offset
  if (idx < 0 || idx >= length) return false
  // size / mult 轮盘：隐藏无法凑成整数点的档位
  if (length === betSizes.length) {
    const raw = betSizes[idx]! * betMultipliers[currentMultIdx.value]! * baseBet
    return Math.abs(raw - Math.round(raw)) <= 1e-9 && Math.round(raw) >= 1
  }
  if (length === betMultipliers.length) {
    const raw = betSizes[currentSizeIdx.value]! * betMultipliers[idx]! * baseBet
    return Math.abs(raw - Math.round(raw)) <= 1e-9 && Math.round(raw) >= 1
  }
  return true
}

const wheelItemClass = (offset: number, currentIdx: number, length: number) => ({
  'is-active': offset === 0,
  'fade-1': Math.abs(offset) === 1,
  'fade-2': Math.abs(offset) === 2,
  'is-empty': !isWheelIndexValid(currentIdx, offset, length),
})

const applyComboByTotal = (total: number) => {
  const combo = validCombinations.find((c) => c.total === total)
  if (combo) {
    currentSizeIdx.value = combo.sizeIdx
    currentMultIdx.value = combo.multIdx
  }
}

/** 仅跳到会产生整数点的 size 档 */
const selectSizeByOffset = (offset: number) => {
  let next = currentSizeIdx.value + offset
  while (next >= 0 && next < betSizes.length) {
    const raw = betSizes[next]! * betMultipliers[currentMultIdx.value]! * baseBet
    if (Math.abs(raw - Math.round(raw)) <= 1e-9 && Math.round(raw) >= 1) {
      currentSizeIdx.value = next
      return
    }
    next += offset > 0 ? 1 : -1
  }
}

/** 仅跳到会产生整数点的倍数档 */
const selectMultByOffset = (offset: number) => {
  let next = currentMultIdx.value + offset
  while (next >= 0 && next < betMultipliers.length) {
    const raw = betSizes[currentSizeIdx.value]! * betMultipliers[next]! * baseBet
    if (Math.abs(raw - Math.round(raw)) <= 1e-9 && Math.round(raw) >= 1) {
      currentMultIdx.value = next
      return
    }
    next += offset > 0 ? 1 : -1
  }
}

const selectTotalByOffset = (offset: number) => {
  if (!canAdjustBet.value) return
  const next = currentTotalIdx.value + offset
  if (next >= 0 && next < validTotals.length) applyComboByTotal(validTotals[next])
}

const formatSizeWheelLabel = (offset: number) => {
  const idx = currentSizeIdx.value + offset
  if (idx < 0 || idx >= betSizes.length) return '—'
  const raw = betSizes[idx]! * betMultipliers[currentMultIdx.value]! * baseBet
  if (Math.abs(raw - Math.round(raw)) > 1e-9) return '—'
  return `¥${betSizes[idx]!.toFixed(2)}`
}

const formatMultWheelLabel = (offset: number) => {
  const idx = currentMultIdx.value + offset
  if (idx < 0 || idx >= betMultipliers.length) return '—'
  const raw = betSizes[currentSizeIdx.value]! * betMultipliers[idx]! * baseBet
  if (Math.abs(raw - Math.round(raw)) > 1e-9) return '—'
  return String(betMultipliers[idx])
}

const formatTotalWheelLabel = (offset: number) => {
  const idx = currentTotalIdx.value + offset
  return idx >= 0 && idx < validTotals.length ? `${validTotals[idx]} 点` : '—'
}

const setMinBet = () => applyComboByTotal(validTotals[0])
const setMaxBet = () => applyComboByTotal(validTotals[validTotals.length - 1])

const increaseBet = () => selectTotalByOffset(1)
const decreaseBet = () => selectTotalByOffset(-1)

// 金额状态：进页同步服务端余额；局内本地演示扣派，离页再拉真余额
const walletStore = useWalletStore()
const balance = ref(0)
const winAmount = ref(0.00)

// 历史记录数据结构
interface GameRecord {
  id: string;
  time: string;
  bet: number;
  profit: number;
}
const historyRecords = ref<GameRecord[]>([])
const showHistoryModal = ref(false)
const historyLoading = ref(false)

const winSummary = computed(() => {
  const records = historyRecords.value
  return {
    count: records.length,
    winCount: records.filter((r) => r.profit > 0).length,
    totalProfit: records.reduce((sum, r) => sum + r.profit, 0),
  }
})

async function loadMahjongHistory() {
  historyLoading.value = true
  try {
    const list = await gamesApi.betHistory()
    const rows = (Array.isArray(list) ? list : [])
      .filter((x) => x.game?.code === 'slots-mahjong')
      .slice(0, 50)
      .map((x) => {
        const bet = Number(x.amount || 0)
        const payout = Number(x.payout || 0)
        return {
          id: String(x.roundNo || x.betNo || x.id),
          time: new Date(x.createdAt).toLocaleTimeString('zh-CN', { hour12: false }),
          bet,
          profit: payout - bet,
        } satisfies GameRecord
      })
    historyRecords.value = rows
  } catch {
    /* 保持现有列表 */
  } finally {
    historyLoading.value = false
  }
}

const currentRecordId = ref('')

async function restoreFreeSpinSession() {
  try {
    const session = await gamesApi.mahjongActiveSession()
    if (!session || session.spinsRemaining <= 0) return
    freeSpinSessionId.value = session.sessionId
    freeSpinsRemaining.value = session.spinsRemaining
    freeSpinSessionWin.value = session.sessionTotalWin
    freeSpinBetAmount.value = session.lockedBetAmount
    isFreeSpinMode.value = true
    applyComboByTotal(session.lockedBetAmount)
  } catch {
    /* 无活跃会话 */
  }
}

// 底部上拉框状态 (wallet, bet, win)
const activePopup = ref<string | null>(null)
const togglePopup = (type: string) => {
  if (type === 'bet' && !canAdjustBet.value) return
  if (type === 'auto' && !canUseAutoSpin.value) return
  if (activePopup.value === type) {
    if (type === 'bet') cancelBetPopup()
    else activePopup.value = null
    return
  }
  if (type === 'bet') {
    betSnapshot.value = { sizeIdx: currentSizeIdx.value, multIdx: currentMultIdx.value }
  }
  activePopup.value = type
}
const closePopup = () => {
  activePopup.value = null
}
const cancelBetPopup = () => {
  currentSizeIdx.value = betSnapshot.value.sizeIdx
  currentMultIdx.value = betSnapshot.value.multIdx
  closePopup()
}
const confirmBetPopup = () => {
  closePopup()
}
const openFullHistory = () => {
  showHistoryModal.value = true
  closePopup()
}

const isSheetPopup = computed(() => ['bet', 'wallet', 'win'].includes(activePopup.value ?? ''))

interface SelectedTileInfo {
  col: number
  row: number
  symbol: MahjongSymbolId
  isGolden: boolean
}

const selectedTile = ref<SelectedTileInfo | null>(null)
const selectedTileAnchor = ref<TileAnchor | null>(null)

const canClickTiles = computed(
  () =>
    !isSpinning.value &&
    !isResolving.value &&
    !activePopup.value &&
    !infoSheetVisible.value &&
    !showHistoryModal.value &&
    !showMenuPage.value &&
    !freeSpinTriggerVisible.value &&
    !freeSpinEndVisible.value,
)

const isTileSelected = (col: number, row: number) =>
  selectedTile.value?.col === col && selectedTile.value?.row === row

const updateTileAnchor = (col: number, row: number) => {
  const el = document.getElementById(`tile-${col}-${row}`)
  const container = document.getElementById('grid-container')
  if (!el || !container) {
    selectedTileAnchor.value = null
    return
  }

  const tileRect = el.getBoundingClientRect()
  const gridRect = container.getBoundingClientRect()
  const tileW = tileRect.width
  const tileH = tileRect.height
  const panelW = tileW * 2.35
  const panelH = tileH

  let x = tileRect.left - gridRect.left + tileW / 2
  let y = tileRect.top - gridRect.top + tileH / 2

  // 上下行微调，避免贴边裁切
  const visibleRow = row - VISIBLE_ROW_INDICES[0]
  if (visibleRow <= 0) y += tileH * 0.08
  else if (visibleRow >= VISIBLE_ROW_INDICES.length - 1) y -= tileH * 0.08

  x = Math.max(panelW / 2 + 2, Math.min(gridRect.width - panelW / 2 - 2, x))
  y = Math.max(panelH / 2 + 2, Math.min(gridRect.height - panelH / 2 - 2, y))

  const gameEl = document.querySelector('.game-container')
  let bgW = gridRect.width
  let bgH = gridRect.height
  let bgPosX = x - panelW / 2
  let bgPosY = y - panelH / 2

  if (gameEl) {
    const gameRect = gameEl.getBoundingClientRect()
    bgW = gameRect.width
    bgH = gameRect.height
    const centerInGameX = tileRect.left - gameRect.left + tileW / 2
    const centerInGameY = tileRect.top - gameRect.top + tileH / 2
    bgPosX = centerInGameX - panelW / 2
    bgPosY = centerInGameY - panelH / 2
  }

  selectedTileAnchor.value = { x, y, w: tileW, h: tileH, bgW, bgH, bgPosX, bgPosY }
}

const clearSelectedTile = () => {
  selectedTile.value = null
  selectedTileAnchor.value = null
}

const onTileClick = async (col: number, row: number) => {
  if (!canClickTiles.value || !isVisibleRow(row)) return
  const cell = gridData.value[col]?.[row]
  if (!cell) return

  if (isTileSelected(col, row)) {
    clearSelectedTile()
    return
  }

  selectedTile.value = {
    col,
    row,
    symbol: cell.symbol,
    isGolden: cell.isGolden,
  }
  await nextTick()
  updateTileAnchor(col, row)
}

watch(isSpinning, (spinning) => {
  if (spinning) clearSelectedTile()
})

watch(isResolving, (resolving) => {
  if (resolving) clearSelectedTile()
})

watch([activePopup, infoSheetVisible, showHistoryModal, showMenuPage], () => {
  clearSelectedTile()
})

watch(isInFreeSpinFeature, () => {
  if (isInFreeSpinFeature.value) {
    if (activePopup.value === 'auto') closePopup()
    if (autoSpinCount.value > 0) autoSpinCount.value = 0
  }
  setupTickerMessage()
})

// 底部走马灯：每条单独配置（不再自动判断）
type TickerSlot = {
  mode: 'center' | 'scroll'
  html: string
  /** 居中句停留时长（ms） */
  centerHoldMs?: number
  /** 长句：先露开头，停顿后再滚（ms） */
  scrollLeadMs?: number
  /** 长句：滚完淡出后，切下一条前的间隔（ms） */
  gapAfterMs?: number
}

const normalTickerSlots: TickerSlot[] = [
  {
    mode: 'center',
    html: '<span class="ticker-line"><span class="ticker-body">赢得高达 </span><span class="ticker-hl">1024</span><span class="ticker-body"> 路！</span></span>',
    centerHoldMs: 3000,
  },
  {
    mode: 'scroll',
    html: '<span class="ticker-line"><span class="ticker-body">获得镀金符号，有机会赢得 </span><span class="ticker-hl">百搭</span></span>',
    scrollLeadMs: 500,
    gapAfterMs: 1000,
  },
  {
    mode: 'scroll',
    html: '<span class="ticker-line"><span class="ticker-body">在免费旋转中，赢得高达 </span><span class="ticker-hl">10</span><span class="ticker-body"> 倍奖金倍数！</span></span>',
    scrollLeadMs: 500,
    gapAfterMs: 1000,
  },
]

const freeSpinTickerSlots = computed((): TickerSlot[] => [
  {
    mode: 'center',
    html: '<span class="ticker-line"><span class="ticker-body">赢得高达 </span><span class="ticker-hl">1024</span><span class="ticker-body"> 路！</span></span>',
    centerHoldMs: 3000,
  },
  {
    mode: 'scroll',
    html: '<span class="ticker-line"><span class="ticker-body">3 个或更多 </span><span class="ticker-hl">胡</span><span class="ticker-body"> 奖励 </span><span class="ticker-hl">12</span><span class="ticker-body"> 次或更多免费旋转</span></span>',
    scrollLeadMs: 500,
    gapAfterMs: 1000,
  },
  {
    mode: 'scroll',
    html: '<span class="ticker-line"><span class="ticker-body">在免费旋转中，赢得高达 </span><span class="ticker-hl">10</span><span class="ticker-body"> 倍奖金倍数！</span></span>',
    scrollLeadMs: 500,
    gapAfterMs: 1000,
  },
])

const activeTickerSlots = computed(() =>
  isInFreeSpinFeature.value ? freeSpinTickerSlots.value : normalTickerSlots,
)

const currentInfoIndex = ref(0)
const tickerMode = ref<'center' | 'scroll'>('center')
const tickerItemRef = ref<HTMLElement | null>(null)
const tickerBarRef = ref<HTMLElement | null>(null)
const tickerItemStyle = ref<Record<string, string>>({})

const currentTickerSlot = computed(() => {
  const slots = activeTickerSlots.value
  if (slots.length === 0) return null
  return slots[currentInfoIndex.value % slots.length] ?? slots[0]
})

const TICKER_SCROLL_SPEED = 100
let tickerHoldTimer: ReturnType<typeof setTimeout> | null = null

function clearTickerTimers() {
  if (tickerHoldTimer) {
    clearTimeout(tickerHoldTimer)
    tickerHoldTimer = null
  }
}

function advanceTickerMessage() {
  const len = activeTickerSlots.value.length
  if (len <= 0) return
  currentInfoIndex.value = (currentInfoIndex.value + 1) % len
  runTickerForCurrentMessage()
}

function measureScrollTextWidth(el: HTMLElement): number {
  const line = el.querySelector('.ticker-line') as HTMLElement | null
  if (!line) return el.scrollWidth
  return Math.ceil(Math.max(line.scrollWidth, line.getBoundingClientRect().width))
}

function runCenterSlot(slot: TickerSlot) {
  tickerMode.value = 'center'
  tickerItemStyle.value = {}
  const hold = slot.centerHoldMs ?? 3000
  tickerHoldTimer = setTimeout(advanceTickerMessage, hold)
}

function runScrollSlot(slot: TickerSlot) {
  tickerMode.value = 'scroll'
  tickerItemStyle.value = {}

  nextTick(() => {
    void document.fonts.ready.then(() => {
      requestAnimationFrame(() => {
        const el = tickerItemRef.value
        const container = tickerBarRef.value
        if (!el || !container) return

        el.style.animation = 'none'
        el.style.transform = 'translateX(0)'
        void el.offsetWidth

        const textWidth = measureScrollTextWidth(el)
        const containerWidth = container.clientWidth
        const fadeOut = Math.round(containerWidth * 0.12)
        const scrollDistance = Math.max(textWidth - containerWidth + fadeOut, 0)
        const leadMs = slot.scrollLeadMs ?? 500
        const durationSec = Math.max(3, scrollDistance / TICKER_SCROLL_SPEED)

        tickerItemStyle.value = {
          '--ticker-scroll-delay': `${leadMs}ms`,
          '--ticker-duration': `${durationSec}s`,
          '--ticker-travel': `-${scrollDistance}px`,
        }

        void el.offsetWidth
        el.style.animation = ''
      })
    })
  })
}

function runTickerForCurrentMessage() {
  clearTickerTimers()
  const slot = currentTickerSlot.value
  if (!slot) return

  if (slot.mode === 'center') {
    runCenterSlot(slot)
  } else {
    runScrollSlot(slot)
  }
}

function setupTickerMessage() {
  currentInfoIndex.value = 0
  runTickerForCurrentMessage()
}

const syncViewportSize = () => {
  viewportSize.value = { w: window.innerWidth, h: window.innerHeight }
}

let spinEndTimer: ReturnType<typeof setTimeout> | null = null

onUnmounted(() => {
  componentDisposed = true
  stopAutoSpin()
  spinSession.clearScheduled()
  mahjongSound.stopAll()
  clearFreeSpinChainTimer()
  clearTickerTimers()
  if (retriggerBannerTimer) {
    clearTimeout(retriggerBannerTimer)
    retriggerBannerTimer = null
  }
  if (spinEndTimer) {
    clearTimeout(spinEndTimer)
    spinEndTimer = null
  }
  window.removeEventListener('keydown', onFsPreviewKeydown)
  window.removeEventListener('resize', refreshAdMsgState)
  window.removeEventListener('resize', syncViewportSize)
  void walletStore.fetchBalance()
})

onMounted(() => {
  componentDisposed = false
  mahjongSound.preload()
  void mahjongSound.startMainBgm()
  syncViewportSize()
  nextTick(refreshAdMsgState)
  window.addEventListener('resize', refreshAdMsgState)
  window.addEventListener('resize', syncViewportSize)
  void walletStore.fetchBalance().then(() => {
    balance.value = walletStore.balance
  })
  void restoreFreeSpinSession()
  void loadMahjongHistory()
  if (import.meta.env.DEV) {
    window.addEventListener('keydown', onFsPreviewKeydown)
    console.info(
      '[麻将 DEV] Alt+1 触发 | Alt+2 再触发 | Alt+3 结束 | Alt+4 消除预览 | Alt+L 布局对照框 | Esc 关闭',
    )
  }
})

// 当前激活的乘数 (索引: 0->X1, 1->X2, 2->X3, 3->X5)
const activeMultiplierIndex = ref(0)

const activeMultGlowInBar = computed(() => {
  const frame = L.multBarFrame ?? L.multBar
  if (!frame) return null
  const idx = activeMultiplierIndex.value
  const slots = multSlots.value
  if (idx < 0 || idx >= slots.length) return null
  return glowBoxInFrame(slots[idx].glowBox, glowClipFrame(frame))
})

const activeMultGlowClip = computed(() => {
  const frame = L.multBarFrame ?? L.multBar
  return frame ? glowClipFrame(frame) : null
})

watch(activeMultiplierIndex, () => {
  if (!isResolving.value && !isSpinning.value) return
  multPulseActive.value = true
  setTimeout(() => {
    multPulseActive.value = false
  }, 450)
})

// 官方 MW1 牌面：5 轴 × 6 行（中间 4 行可见区参与中奖）
const gridData = ref<TileCell[][]>(createEmptyGrid())
const spinningCols = ref<TileCell[][]>(Array.from({ length: COLS }, () => []))

const handleSpinClick = async (opts?: { fromFreeSpinChain?: boolean }) => {
  if (isSpinning.value || isResolving.value || freeSpinTriggerVisible.value || freeSpinEndVisible.value) {
    return
  }

  const isFreeSpinSpin = isFreeSpinMode.value && freeSpinsRemaining.value > 0
  if (isFreeSpinSpin && !opts?.fromFreeSpinChain) return
  if (!isFreeSpinSpin && balance.value < betAmount.value) return

  isActiveFreeSpinSpin.value = isFreeSpinSpin
  winAmount.value = 0
  infoboardWinIsTotal.value = false
  activeMultiplierIndex.value = 0
  winningCells.value.clear()
  explodingCells.value.clear()
  transformingCells.value.clear()
  tileDropMotions.value.clear()
  isSpinning.value = true
  mahjongSound.playSpinButtonClick(isTurbo.value)

  try {
    const clientRequestId = spinSession.currentOrNewClientRequestId()
    const charged = betAmount.value
    const result = await gamesApi.mahjongSpin({
      // 仅发送整数点组合（见 validCombinations）
      amount: isFreeSpinSpin ? 0 : charged,
      clientRequestId,
      sessionId: isFreeSpinSpin ? freeSpinSessionId.value ?? undefined : undefined,
    })
    spinSession.clearClientRequestId()
    if (componentDisposed || spinSession.disposed.value) return

    if (
      !isFreeSpinSpin &&
      typeof result.chargedAmount === 'number' &&
      result.chargedAmount !== charged
    ) {
      applyComboByTotal(result.chargedAmount)
    }

    walletStore.balance = result.balance
    balance.value = result.balance
    currentRecordId.value = result.roundId
    applyServerFreeSpinState(result)

    const finalGrid = result.initialGrid.map((col) => col.map((t) => ({ ...t }))) as TileCell[][]
    spinningCols.value = Array.from({ length: COLS }, (_, colIndex) => {
      const currentTiles = gridData.value[colIndex].map((t) => ({ ...t }))
      const blurTiles = Array.from({ length: REEL_BLUR_TILE_COUNT }, () => rollTile(colIndex))
      return [...currentTiles, ...blurTiles, ...finalGrid[colIndex]]
    })
    gridData.value = finalGrid

    columnSpinning.value = Array(COLS).fill(true)
    columnReelBounce.value = Array(COLS).fill(false)

    const delays = isTurbo.value ? REEL_STOP_DELAYS.turbo : REEL_STOP_DELAYS.normal
    const bounceMs = isTurbo.value ? REEL_BOUNCE_MS.turbo : REEL_BOUNCE_MS.normal
    const totalSpinMs = delays[COLS - 1]! + bounceMs

    await new Promise<void>((resolve) => {
      spinEndTimer = setTimeout(() => {
        spinEndTimer = null
        resolve()
      }, totalSpinMs)
    })
    if (componentDisposed) return

    for (let col = 0; col < COLS; col++) {
      if (columnSpinning.value[col]) onReelSpinEnd(col)
    }
    isSpinning.value = false
    await runCascadeResolution(result)
  } catch (e) {
    isSpinning.value = false
    isActiveFreeSpinSpin.value = false
    columnSpinning.value = Array(COLS).fill(false)
    try {
      await walletStore.fetchBalance()
      balance.value = walletStore.balance
    } catch {
      /* ignore */
    }
    const msg = e instanceof Error ? e.message : '开奖失败'
    toast(msg)
    console.error('[麻将] spin 失败', e)
  }
}
</script>

<style scoped src="./MahjongGameView.css"></style>
