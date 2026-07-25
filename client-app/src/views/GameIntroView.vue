<template>
  <div class="screen-deco" aria-hidden="true">
    <img class="cd cd-tl" src="/images/corner-flourish.png" alt="">
    <img class="cd cd-tr" src="/images/corner-flourish.png" alt="">
    <img class="cd cd-bl" src="/images/corner-flourish.png" alt="">
    <img class="cd cd-br" src="/images/corner-flourish.png" alt="">
  </div>

  <div class="page gi-page">
    <div class="app-bar">
      <div class="back" @click="router.back()">‹</div>
      <div class="title">游 戏 介 绍</div>
      <div class="right"></div>
    </div>

    <div class="page-body">
      <h1 class="gi-hero">金 御 汇 · 游 戏 馆</h1>
      <p class="gi-lead">精选彩票竞猜与即开娱乐，公平开奖、即时结算。点选分类了解玩法。</p>

      <section v-for="sec in sections" :key="sec.id" class="gi-section">
        <div class="gi-sec-head">
          <span class="gi-sec-mark" aria-hidden="true"></span>
          <h2 class="gi-sec-title">{{ sec.title }}</h2>
          <span class="gi-sec-sub">{{ sec.sub }}</span>
        </div>
        <div class="gi-list">
          <article v-for="g in sec.games" :key="g.name" class="gi-card">
            <div class="gi-card-top">
              <h3 class="gi-name">{{ g.name }}</h3>
              <span class="gi-tag">{{ g.tag }}</span>
            </div>
            <p class="gi-desc">{{ g.desc }}</p>
          </article>
        </div>
      </section>

      <div class="gi-note">
        说明：具体赔率与玩法细则以游戏内规则页为准；下注请量力而行。
      </div>
      <div class="lobby-spacer"></div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useRouter } from 'vue-router'
import { useBodyClass } from '@/composables/useBodyClass'
import '@/assets/game-intro.css'

useBodyClass('deco-bg')
const router = useRouter()

const sections = [
  {
    id: 'digit',
    title: '时时彩 · 快三',
    sub: '数字竞猜',
    games: [
      { name: '快乐时时彩', tag: '五星', desc: '五位开奖，含总和两面、定位胆、龙虎、斗牛、前中后形态等玩法。' },
      { name: '1分时时彩', tag: '一分', desc: '节奏更快的五星玩法，口令与快乐时时彩一致，适合短局跟进。' },
      { name: '1分快三', tag: '骰子', desc: '三枚骰子开奖：大小单双、和值、三军、二同、三同、长牌等。' },
    ],
  },
  {
    id: 'race',
    title: '赛车 · 飞艇',
    sub: '名次竞猜',
    games: [
      { name: '北京赛车', tag: '经典', desc: '十车竞速：赛道两面、定位车号、冠亚和、龙虎组。' },
      { name: '极速赛车', tag: '极速', desc: '同款 PK10 玩法，开奖更快，赛道数字口令下注。' },
      { name: '幸运飞艇', tag: '飞艇', desc: '飞艇版名次竞猜，玩法对齐赛车房，口令一致。' },
    ],
  },
  {
    id: 'lhc',
    title: '六合彩',
    sub: '特码生肖',
    games: [
      { name: '幸运六合彩', tag: '七码', desc: '特码两面、色波、一肖、尾数、生肖连、连码拖头等丰富玩法。' },
    ],
  },
  {
    id: 'card',
    title: '牌类对决',
    sub: '聊天房',
    games: [
      { name: '炸金花', tag: '热门', desc: '庄闲各三张比牌型（豹子＞顺金＞金花＞顺子＞对子＞散牌），可押边注。' },
      { name: '斗牛', tag: '经典', desc: '庄闲各五张算牛，无和局；可押庄闲与牛几/五花等边注。' },
      { name: '百家乐', tag: '热门', desc: '庄闲和与对子，标准补牌规则，牌桌感强。' },
      { name: '龙虎斗', tag: '新品', desc: '龙虎各一张比大小，和局退本；赢利抽水后约 1:0.95。' },
    ],
  },
  {
    id: 'instant',
    title: '即开娱乐',
    sub: '街机电子',
    games: [
      { name: '水果机', tag: '街机', desc: '经典转盘灯格，多种彩金与特殊奖。' },
      { name: '奔驰宝马', tag: '新品', desc: '豪车转盘竞猜，灯光跑马开奖。' },
      { name: '麻将胡了', tag: '热门', desc: '麻将主题电子，免费局与倍数玩法。' },
    ],
  },
]
</script>
