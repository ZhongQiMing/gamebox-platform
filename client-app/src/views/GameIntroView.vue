<template>
  <div class="screen-deco" aria-hidden="true">
    <img class="cd cd-tl" src="/images/corner-flourish.webp" loading="lazy" decoding="async" alt="">
    <img class="cd cd-tr" src="/images/corner-flourish.webp" loading="lazy" decoding="async" alt="">
    <img class="cd cd-bl" src="/images/corner-flourish.webp" loading="lazy" decoding="async" alt="">
    <img class="cd cd-br" src="/images/corner-flourish.webp" loading="lazy" decoding="async" alt="">
  </div>

  <div class="page gi-page">
    <div class="app-bar">
      <div class="back" @click="router.back()">‹</div>
      <div class="title">游 戏 介 绍</div>
      <div class="right"></div>
    </div>

    <div class="page-body">
      <h1 class="gi-hero">金 御 汇</h1>
      <p class="gi-lead">数字彩、赛车飞艇、牌桌与街机一站汇集。开奖可验、结算及时，按分类了解各游戏玩法特色。</p>

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
        赔率、限红与详细规则以进入游戏后的规则说明为准。请理性娱乐，量力而行。
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
    sub: '数字开奖',
    games: [
      {
        name: '快乐时时彩',
        tag: '五星',
        desc: '每期开出五位数字。可猜大小单双、指定位置号码，也可玩龙虎、斗牛与前中后组选等，玩法多样、节奏稳健。',
      },
      {
        name: '1分时时彩',
        tag: '极速',
        desc: '与快乐时时彩同属五星玩法，约一分钟一期，适合喜欢快节奏跟局的玩家。',
      },
      {
        name: '1分快三',
        tag: '骰子',
        desc: '三枚骰子开奖。可猜大小单双、和值点数，也可押三军、二同号、三同号、连号等经典骰宝玩法。',
      },
    ],
  },
  {
    id: 'race',
    title: '赛车 · 飞艇',
    sub: '名次竞猜',
    games: [
      {
        name: '北京赛车',
        tag: '经典',
        desc: '十车争夺名次。可猜冠亚季等名次、各赛道大小单双，也可玩冠亚和值、龙虎对决，临场感强。',
      },
      {
        name: '极速赛车',
        tag: '极速',
        desc: '玩法与北京赛车相同，开奖间隔更短，适合追求连续竞猜、快速开奖的玩家。',
      },
      {
        name: '幸运飞艇',
        tag: '飞艇',
        desc: '以飞艇竞速呈现的名次竞猜，规则与赛车类一致，画面风格更轻快。',
      },
    ],
  },
  {
    id: 'lhc',
    title: '六合彩',
    sub: '特码生肖',
    games: [
      {
        name: '幸运六合彩',
        tag: '七码',
        desc: '正码加特码开奖。可猜特码大小单双与色波，也可玩生肖、尾数、连肖连码等，玩法层次丰富。',
      },
    ],
  },
  {
    id: 'card',
    title: '牌类对决',
    sub: '庄闲对战',
    games: [
      {
        name: '炸金花',
        tag: '热门',
        desc: '庄闲各发三张牌，比牌型大小。豹子最大，其次顺金、金花、顺子、对子、散牌；也可加押边注增加趣味。',
      },
      {
        name: '斗牛',
        tag: '经典',
        desc: '庄闲各五张牌拼牛。有牛比点数，无牛比散牌；可押庄闲胜负，也可押牛几、五花牛等结果。',
      },
      {
        name: '百家乐',
        tag: '热门',
        desc: '经典百家乐：押庄、闲或和。按标准规则发牌与补牌，点数更接近 9 的一方获胜；也可押对子。',
      },
      {
        name: '龙虎斗',
        tag: '简洁',
        desc: '龙、虎各开一张牌比点数，简单直观。押中龙或虎即赢；开和则本金退回。',
      },
    ],
  },
  {
    id: 'instant',
    title: '即开娱乐',
    sub: '街机电子',
    games: [
      {
        name: '水果机',
        tag: '街机',
        desc: '经典水果灯格转盘。押中停格图案即可获奖，另有多种特殊大奖与再猜大小环节，即开即乐。',
      },
      {
        name: '奔驰宝马',
        tag: '转盘',
        desc: '以名车品牌为图案的跑马灯转盘。可同时押多个车位，灯光停定时开奖，节奏明快。',
      },
    ],
  },
]
</script>
