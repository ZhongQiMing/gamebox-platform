<template>
  <!--
    正版 shell logo（竖屏）：
    #svg-logo 70×37 flex-column translateZ(0)
      #gradient-color z-index:-99（彩虹裁剪层）
      #svg-logo-container 62×31 → svg 62×28 白字 PG
      #pg-svg-text 70×6 白字标题
  -->
  <div
    id="svg-logo"
    ref="rootRef"
    class="svg-logo"
    style="display: flex; flex-direction: column; backface-visibility: hidden; transform: translateZ(0);"
  >
    <!--
      必须带 width/height 属性：仅 CSS 尺寸时嵌套 SVG 的 fill 不绘制
      （正版 shell 也会写出 300×150 / 200×100）
    -->
    <svg
      id="gradient-color"
      xmlns="http://www.w3.org/2000/svg"
      width="300"
      height="150"
      aria-hidden="true"
      style="position: absolute; z-index: -99; opacity: 0;"
    >
      <svg
        id="logo-gradient"
        width="200"
        height="100"
        style="position: absolute; z-index: 1; clip-path: url(#logo-clip-path); width: 200px; height: 100px;"
      >
        <defs>
          <clipPath id="logo-clip-path" />
          <linearGradient
            id="color-a"
            gradientUnits="objectBoundingBox"
            x1="0"
            y1="0"
            x2="1"
            y2="1"
          >
            <stop offset="0" stop-color="#d888f3">
              <animate
                id="color-#d888f3"
                attributeName="stop-color"
                values="#d888f3;#fee8a1;#a0f5b2;#30f4e1;#42b1ff;#78fbf0;#a3bdfa;#d888f3;"
                dur="6s"
                repeatCount="indefinite"
              />
            </stop>
            <stop offset="0.5" stop-color="#8aadff">
              <animate
                id="color-#8aadff"
                attributeName="stop-color"
                values="#8aadff;#78fbf0;#42b1ff;#8aadff;#a0f5b2;fee8a1;#d888f3;#8aadff;"
                dur="6s"
                repeatCount="indefinite"
              />
            </stop>
            <stop offset="1" stop-color="#30f4e1">
              <animate
                id="color-#30f4e1"
                attributeName="stop-color"
                values="#30f4e1;#d888f3;#42b1ff;#8aadff;#a0f5b2;#78fbf0;#78fbf0;#30f4e1;"
                dur="6s"
                repeatCount="indefinite"
              />
            </stop>
          </linearGradient>
        </defs>
        <rect fill="url(#color-a)" width="200" height="100" />
        <g transform="translate(-80, -10)">
          <rect
            fill="white"
            width="10"
            height="70"
            style="transform: rotate(30deg)"
          />
          <animateTransform
            id="shine-animate"
            attributeName="transform"
            type="translate"
            from="-80 -10"
            to="160 -10"
            dur="1s"
            begin="2s;shine-animate.end+2s"
            end="indefinite"
          />
        </g>
      </svg>
    </svg>

    <div
      id="svg-logo-container"
      style="height: 31px; width: 62px; opacity: 1;"
    >
      <svg
        id="pg-footer-svg"
        width="62"
        height="28"
        viewBox="0 0 62 28"
        xmlns="http://www.w3.org/2000/svg"
        overflow="visible"
        aria-hidden="true"
      >
        <g id="PG-Logo">
          <g id="PG-Color-Top">
            <path id="G-Yelow" fill-rule="evenodd" clip-rule="evenodd" d="M41.75 0H39.25V2.49997H41.75V0Z" fill="#FFB919">
              <animateTransform attributeName="transform" type="translate" dur="1.6s" values="0 0; 0 0; 0 -5; 0 0" keyTimes="0; 0.83; 0.88; 1" end="indefinite" />
            </path>
            <path id="G-Green" fill-rule="evenodd" clip-rule="evenodd" d="M61.5 11.2499H59V13.7498H61.5V11.2499Z" fill="#14E691">
              <animateTransform attributeName="transform" type="translate" dur="1.6s" values="0 0; 0 0; 0 -10; 0 0" keyTimes="0; 0.83; 0.88; 1" end="indefinite" />
            </path>
            <path id="G-Dark-Red" fill-rule="evenodd" clip-rule="evenodd" d="M36 5.74994H33.5V8.24991H36V5.74994Z" fill="#E61973">
              <animateTransform attributeName="transform" type="translate" dur="1.6s" values="0 0; 0 0; 0 -5; 0 0" keyTimes="0; 0.83; 0.88; 1" end="indefinite" />
            </path>
            <path id="P-Orange" fill-rule="evenodd" clip-rule="evenodd" d="M28 2.74997H25.5V5.24994H28V2.74997Z" fill="#FF6E00">
              <animateTransform attributeName="transform" type="translate" dur="1.6s" values="0 0; 0 0; 0 -10; 0 0" keyTimes="0; 0.83; 0.88; 1" end="indefinite" />
            </path>
            <path id="P-Purple" fill-rule="evenodd" clip-rule="evenodd" d="M2.5 2.74997H0V5.24994H2.5V2.74997Z" fill="#6414E6">
              <animateTransform attributeName="transform" type="translate" dur="1.6s" values="0 0; 0 0; 0 -5; 0 0" keyTimes="0; 0.83; 0.88; 1" end="indefinite" />
            </path>
            <animate attributeName="opacity" dur="0.5s" values="0; 0; 1" keyTimes="0; 0; 1" end="indefinite" />
          </g>
          <g id="PG-Color-Bottom">
            <path id="Fill-18" fill-rule="evenodd" clip-rule="evenodd" d="M2.75 27.8544H5.20367V25.4042H2.75V27.8544Z" fill="#19BEE6" />
            <path id="Fill-19" fill-rule="evenodd" clip-rule="evenodd" d="M16.9104 22.2H19.3649V19.7498H16.9104V22.2Z" fill="#E619DC" />
            <path id="Fill-24" fill-rule="evenodd" clip-rule="evenodd" d="M36.2829 25.0272H38.7374V22.577H36.2829V25.0272Z" fill="#1987E6" />
            <path id="Fill-25" fill-rule="evenodd" clip-rule="evenodd" d="M53.2754 27.8544H55.7304V25.4042H53.2754V27.8544Z" fill="#FF4B00" />
            <path id="Fill-27" fill-rule="evenodd" clip-rule="evenodd" d="M58.9402 22.2H61.3948V19.7502H58.9402V22.2Z" fill="#FF1928" />
            <animate attributeName="opacity" dur="0.5s" values="0; 0; 1" keyTimes="0; 0; 1" end="indefinite" />
          </g>
          <g id="PG5">
            <path id="Fill-20" fill-rule="evenodd" clip-rule="evenodd" d="M16.993 2.45026H19.448V0H16.993V2.45026ZM8.4965 5.27791H10.9511V2.82764H8.4965V5.27791ZM19.8252 8.10465H22.2797V5.65439H19.8252V8.10465ZM25.4899 10.9323H27.9441V8.48158H25.4899V10.9323ZM0 13.7586H2.45457V11.3097H0V13.7586ZM25.4899 16.5862H27.9441V14.136H25.4899V16.5862ZM11.3287 22.2406H13.7832V19.7903H11.3287V22.2406ZM2.83217 25.0678H5.28674V22.6175H2.83217V25.0678ZM0 10.9323H2.45457V8.48203H0V10.9323ZM22.6573 5.27746H25.1119V2.82719H22.6573V5.27746Z" fill="white" />
            <path id="Fill-21" fill-rule="evenodd" clip-rule="evenodd" d="M50.5263 2.45026H52.9809V0H50.5263V2.45026ZM53.3585 8.10465H55.8126V5.65439H53.3585V8.10465ZM39.1977 8.10465H41.6518V5.65439H39.1977V8.10465ZM53.3585 16.5862H55.8126V14.136H53.3585V16.5862ZM59.0228 19.4134H61.4774V16.9636H59.0228V19.4134ZM44.862 25.0683H47.3166V22.618H44.862V25.0683ZM50.5263 27.895H52.9809V25.4447H50.5263V27.895Z" fill="white" />
            <animate attributeName="opacity" dur="0.5s" values="0; 0; 1" keyTimes="0; 0.8; 1" end="indefinite" />
          </g>
          <g id="PG4">
            <path id="Fill-20_2" fill-rule="evenodd" clip-rule="evenodd" d="M2.83217 2.45026H5.28583V0H2.83217V2.45026ZM14.1613 5.27791H16.6159V2.82764H14.1613V5.27791ZM2.83217 8.1051H5.28674V5.65484H2.83217V8.1051ZM22.6573 10.9323H25.1119V8.48158H22.6573V10.9323ZM2.83217 16.5867H5.28674V14.1364H2.83217V16.5867ZM14.1613 19.4134H16.6159V16.9636H14.1613V19.4134ZM0 22.2406H2.45457V19.7908H0V22.2406Z" fill="white" />
            <path id="Fill-21_2" fill-rule="evenodd" clip-rule="evenodd" d="M42.0294 5.27744H44.4839V2.82718H42.0294V5.27744ZM56.1902 13.7595H58.6448V11.3097H56.1902V13.7595ZM47.6937 13.7595H50.1483V11.3097H47.6937V13.7595ZM33.5329 16.5867H35.9879V14.1364H33.5329V16.5867ZM56.1902 22.2406H58.6448V19.7903H56.1902V22.2406Z" fill="white" />
            <animate attributeName="opacity" dur="0.5s" values="0; 0; 1" keyTimes="0; 0.7; 1" end="indefinite" />
          </g>
          <g id="PG3">
            <path id="Fill-20_3" fill-rule="evenodd" clip-rule="evenodd" d="M8.4965 2.45026H10.9511V0H8.4965V2.45026ZM19.8252 5.27791H22.2797V2.82764H19.8252V5.27791ZM16.993 5.27791H19.448V2.82764H16.993V5.27791ZM5.66388 5.27791H8.1189V2.82764H5.66388V5.27791ZM22.6573 8.10465H25.1119V5.65439H22.6573V8.10465ZM2.83217 10.9323H5.28674V8.48158H2.83217V10.9323ZM22.6573 13.759H25.1119V11.3088H22.6573V13.759ZM22.6573 16.5862H25.1119V14.136H22.6573V16.5862ZM0 16.5858H2.45457V14.1364H0V16.5858ZM22.6573 19.4134H25.1119V16.9636H22.6573V19.4134ZM5.66388 19.4134H8.1189V16.9636H5.66388V19.4134ZM14.1613 22.2406H16.6159V19.7903H14.1613V22.2406ZM5.66388 22.2406H8.1189V19.7903H5.66388V22.2406Z" fill="white" />
            <path id="Fill-21_3" fill-rule="evenodd" clip-rule="evenodd" d="M42.0298 2.45026H44.4844V0H42.0298V2.45026ZM44.862 5.27746H47.3166V2.82719H44.862V5.27746ZM53.3585 5.27791H55.8126V2.82764H53.3585V5.27791ZM36.3655 10.9323H38.8201V8.48158H36.3655V10.9323ZM36.3655 13.759H38.8201V11.3088H36.3655V13.759ZM56.1902 19.4143H58.6448V16.9636H56.1902V19.4143ZM39.1977 22.2411H41.6518V19.7908H39.1977V22.2411ZM53.3585 25.0678H55.8126V22.6175H53.3585V25.0678ZM42.0298 27.895H44.4844V25.4447H42.0298V27.895Z" fill="white" />
            <animate attributeName="opacity" dur="0.5s" values="0; 0; 1" keyTimes="0; 0.6; 1" end="indefinite" />
          </g>
          <g id="PG2">
            <path id="Fill-20_4" fill-rule="evenodd" clip-rule="evenodd" d="M19.8261 2.45026H22.2797V0H19.8261V2.45026ZM11.3291 2.45026H13.7828V0H11.3291V2.45026ZM2.83217 5.27791H5.28674V2.82764H2.83217V5.27791ZM25.4899 8.10465H27.9441V5.65439H25.4899V8.10465ZM0 8.1042H2.45457V5.65484H0V8.1042ZM2.83217 13.7595H5.28674V11.3097H2.83217V13.7595ZM19.8252 16.5862H22.2797V14.136H19.8252V16.5862ZM19.8252 19.4134H22.2797V16.9636H19.8252V19.4134ZM16.993 19.4134H19.448V16.9636H16.993V19.4134ZM2.83217 19.4134H5.28674V16.9636H2.83217V19.4134ZM8.4965 22.2406H10.9511V19.7903H8.4965V22.2406ZM2.83217 22.2406H5.28674V19.7903H2.83217V22.2406ZM0 27.895H2.45457V25.4447H0V27.895Z" fill="white" />
            <path id="Fill-21_4" fill-rule="evenodd" clip-rule="evenodd" d="M47.6941 2.45026H50.1478V0H47.6941V2.45026ZM47.6937 5.27746H50.1483V2.82719H47.6937V5.27746ZM56.1902 5.27791H58.6448V2.82764H56.1902V5.27791ZM39.1977 5.27791H41.6518V2.82764H39.1977V5.27791ZM56.1902 8.10465H58.6448V5.65439H56.1902V8.10465ZM36.3655 8.1051H38.8201V5.65484H36.3655V8.1051ZM53.3585 13.7595H55.8126V11.3097H53.3585V13.7595ZM33.5329 13.7595H35.9879V11.3097H33.5329V13.7595ZM50.5259 16.5862H52.9804V14.136H50.5259V16.5862ZM47.6937 16.5862H50.1483V14.136H47.6937V16.5862ZM59.0228 16.5858H61.4774V14.1364H59.0228V16.5858ZM36.3655 19.4134H38.8201V16.9636H36.3655V19.4134ZM33.5329 19.4143H35.9879V16.9636H33.5329V19.4143ZM53.3585 22.2411H55.8126V19.7908H53.3585V22.2411ZM36.3655 22.2411H38.8201V19.7908H36.3655V22.2411ZM56.1902 25.0678H58.6448V22.6175H56.1902V25.0678ZM47.6937 25.0683H50.1483V22.618H47.6937V25.0683ZM39.1977 25.0683H41.6518V22.618H39.1977V25.0683ZM47.6941 27.895H50.1478V25.4447H47.6941V27.895ZM44.8615 27.895H47.3166V25.4447H44.8615V27.895Z" fill="white" />
            <animate attributeName="opacity" dur="0.5s" values="0; 0; 1" keyTimes="0; 0.5; 1" end="indefinite" />
          </g>
          <g id="PG1">
            <path id="Fill-20_5" fill-rule="evenodd" clip-rule="evenodd" d="M19.8261 2.45026H22.2797V0H19.8261V2.45026ZM14.1613 2.45026H16.6149V0H14.1613V2.45026ZM5.66478 2.45026H8.118V0H5.66478V2.45026ZM11.3287 5.27791H13.7832V2.82764H11.3287V5.27791ZM22.6573 8.10465H25.1119V5.65439H22.6573V8.10465ZM0 8.1042H2.45457V5.65484H0V8.1042ZM25.4899 13.759H27.9441V11.3088H25.4899V13.759ZM11.3287 19.4134H13.7832V16.9636H11.3287V19.4134ZM8.4965 19.4134H10.9511V16.9636H8.4965V19.4134ZM0 19.4134H2.45457V16.9636H0V19.4134ZM14.1613 22.2406H16.6159V19.7903H14.1613V22.2406ZM0 25.0669H2.45457V22.618H0V25.0669Z" fill="white" />
            <path id="Fill-21_5" fill-rule="evenodd" clip-rule="evenodd" d="M44.8615 2.45026H47.3166V0H44.8615V2.45026ZM50.5259 5.27746H52.9804V2.82719H50.5259V5.27746ZM36.3655 5.27791H38.8201V2.82764H36.3655V5.27791ZM33.5329 10.9323H35.9879V8.48158H33.5329V10.9323ZM50.5259 13.7595H52.9804V11.3097H50.5259V13.7595ZM36.3655 16.5862H38.8201V14.136H36.3655V16.5862ZM56.1902 16.5867H58.6448V14.1364H56.1902V16.5867ZM33.5329 22.2406H35.9879V19.7903H33.5329V22.2406ZM50.5259 25.0683H52.9804V22.618H50.5259V25.0683ZM42.0294 25.0683H44.4839V22.618H42.0294V25.0683ZM39.1981 27.895H41.6513V25.4447H39.1981V27.895Z" fill="white" />
            <animate attributeName="opacity" dur="0.5s" values="0; 0; 1" keyTimes="0; 0.3; 1" end="indefinite" />
          </g>
          <animateTransform attributeName="transform" type="translate" dur="1.5s" values="0 0; 0 0; 0 -5; 0 0" keyTimes="0; 0.88; 0.91; 1" end="indefinite" />
        </g>
      </svg>
    </div>

    <svg
      id="pg-svg-text"
      width="70"
      height="6"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      style="filter: blur(0px); opacity: 1;"
    >
      <g id="PG-Title" fill="#FFF">
        <path d="M3.004.842v.599h.602v1.8h-.602v.6H1.201v1.8H0V.84h3.004Zm-.6 1.198H1.202v.602h1.204V2.04ZM4.804.842v.599h-.599v3.6h.602v.6H7.21v-.6h.602V1.443H7.21V.844H4.804V.842Zm.602 1.198h1.201v2.4h-1.2v-2.4ZM9.012.841v.6H8.41v3.6h.602v.597h2.403V5.04h.601V3.84h-1.201v.6H9.612v-2.4h1.203v.602h1.201v-1.2h-.601v-.6zM15.021.841V2.64h-1.202L13.817.841h-1.201l.002 4.797h1.201V3.84l1.202-.003v1.801h1.201v-1.8h-.602V2.638h.602V.841zM16.824.841v4.797h3.606V4.44h-2.405v-.602h1.803V2.64h-1.803V2.04h2.405V.841zM21.029.841v1.2h1.201v3.597h1.204V2.04l1.201-.003V.84zM27.037.84v.598h-.602V5.04h.602v.6h2.402v-.6h.602v-2.4h-1.803v1.198h.602v.602h-1.204V2.037h1.803V.84zM33.647.839v.6h.602v4.199h-1.204V4.44h-1.2v1.198h-1.202v-4.2h.6v-.6h2.404Zm-.602 1.198h-1.204v1.201h1.204v-1.2ZM38.454.84v.598h-.602v.6h-.602v.601h-.599v-.602h-.602v-.599h-.602V.84h-.599v4.8l1.201-.004V3.837h.602v.6h.599v-.6h.602v1.798h1.201V.84zM39.653.84l.002 4.795h3.606l-.002-1.198h-2.403l-.002-.6h1.803v-1.2l-1.803.002v-.602h2.405V.84zM44.46.84v.598h-.599v1.798h.599v.6h1.803v.601h-2.402v1.198h3.004v-.599h.602v-1.8h-.602v-.6h-1.803v-.599h2.405v-1.2zM49.866.836v.602h-.599v1.798h.599v.6h1.803v.601h-2.402v1.198h3.004v-.599h.602v-1.8h-.602v-.6h-1.803v-.602h2.405V.836zM56.476.839v.6h.602v3.597h-.602v.6h-2.402v-.6h-.602v-3.6h.6V.838h2.404Zm-.602 1.198h-1.2v2.4h1.2v-2.4ZM57.677.836l.003 4.8h1.201v-1.8h1.8v-1.2h-1.803v-.602h2.405V.836zM61.885.836v1.198h1.201v3.601h1.204l-.003-3.6h1.204L65.488.835zM67.808 1.798h.4c.117 0 .21-.027.277-.086a.276.276 0 0 0 .098-.223.276.276 0 0 0-.104-.23.45.45 0 0 0-.282-.082h-.392v.618h.003v.003Zm-.351.985V.882h.783c.22 0 .394.053.519.16.125.106.186.255.186.447a.558.558 0 0 1-.386.54l.442.754H68.6l-.4-.695h-.394v.695h-.348Zm2.205-.967A1.464 1.464 0 0 0 68.18.336h-.024a1.48 1.48 0 0 0-1.289.73c-.13.223-.197.473-.197.75v.024a1.464 1.464 0 0 0 .732 1.287c.227.133.477.2.754.2h.024c.277 0 .527-.067.751-.2.224-.13.4-.312.533-.536.13-.223.197-.474.197-.75v-.025Zm.338 0v.024a1.81 1.81 0 0 1-.527 1.292 1.808 1.808 0 0 1-1.292.527h-.024c-.256 0-.495-.048-.716-.138a1.808 1.808 0 0 1-.58-.39 1.81 1.81 0 0 1-.525-1.292v-.023A1.81 1.81 0 0 1 66.86.527 1.808 1.808 0 0 1 68.157 0h.024a1.81 1.81 0 0 1 1.292.527c.165.165.295.36.388.578.094.221.139.458.139.711Z" />
      </g>
    </svg>
  </div>
</template>

<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { mountPgLogoColorCycle } from '@/games/pg-common/pgFooterLogoAnimator'

const rootRef = ref<HTMLElement | null>(null)

let cleanup: (() => void) | null = null

onMounted(async () => {
  await nextTick()
  if (!rootRef.value) return
  cleanup = mountPgLogoColorCycle(rootRef.value)
})

onBeforeUnmount(() => {
  cleanup?.()
  cleanup = null
})
</script>

<style scoped>
.svg-logo {
  position: relative;
  width: 70px;
  height: 37px;
  flex-shrink: 0;
}

#gradient-color {
  width: 300px;
  height: 150px;
  overflow: hidden;
  pointer-events: none;
}

#pg-footer-svg {
  display: block;
  width: 62px;
  height: 28px;
}

#pg-svg-text {
  display: block;
  width: 70px;
  height: 6px;
  flex-shrink: 0;
}
</style>
