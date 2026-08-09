<template>
  <div class="screen-deco" aria-hidden="true">
    <img class="cd cd-tl" src="/images/corner-flourish.png" alt="">
    <img class="cd cd-tr" src="/images/corner-flourish.png" alt="">
    <img class="cd cd-bl" src="/images/corner-flourish.png" alt="">
    <img class="cd cd-br" src="/images/corner-flourish.png" alt="">
  </div>

  <div class="page legal-page">
    <div class="app-bar">
      <div class="back" @click="router.back()">‹</div>
      <div class="title">隐 私 政 策</div>
      <div class="right"></div>
    </div>

    <div class="page-body">
      <p class="legal-updated">最近更新：{{ UPDATED_AT }}</p>

      <div class="legal-card">
        <p class="legal-p">
          本政策说明 <b><span :class="{ 'legal-todo': isPlaceholder }">{{ OPERATOR }}</span></b>
          （下称「我们」）在你使用本应用时会收集哪些信息、怎么使用，以及你可以怎么管理它们。
        </p>

        <h2 class="legal-h2">一、我们收集什么</h2>
        <p class="legal-p">
          <b>账号信息：</b>登录账号、昵称、头像、系统分配的 UID。注册只需账号和密码，
          我们不要求手机号、身份证或人脸。
        </p>
        <p class="legal-p">
          <b>资金与游戏记录：</b>上下分申请、积分变动流水、下注与开奖结果。
          这部分是对账凭证，也是处理纠纷的唯一依据。
        </p>
        <p class="legal-p">
          <b>设备与日志：</b>登录时间、登录 IP。仅用于登录保护与风控，
          例如识别同一 IP 下的异常对打。
        </p>
        <p class="legal-p">我们不收集通讯录、短信、精确位置，也不读取相册（上传头像时你主动选择的图片除外）。</p>

        <h2 class="legal-h2">二、怎么使用</h2>
        <p class="legal-p">
          用于：完成上下分与结算、展示你的账目、按规则计算回水与佣金、
          识别作弊与异常登录、以及应你要求提供客服支持。
        </p>
        <p class="legal-p">我们不会把你的信息用于广告推送，也不会售卖给第三方。</p>

        <h2 class="legal-h2">三、谁能看到</h2>
        <p class="legal-p">
          你所在房间的代理与客服，能看到为你服务所必需的部分：昵称、UID、余额、
          上下分申请与注单记录。他们看不到你的密码。
        </p>
        <p class="legal-p">除法律法规要求外，我们不会向其他第三方提供你的信息。</p>

        <h2 class="legal-h2">四、保存多久</h2>
        <p class="legal-p">
          <b>个人信息：</b>昵称、头像、登录 IP 在你注销时立即清除。
        </p>
        <p class="legal-p">
          <b>账上余额：</b>注销时清零，不再保留。
        </p>
        <p class="legal-p">
          <b>资金与游戏记录：</b>上下分、积分流水、注单是对账与纠纷处理的唯一依据，
          按财务要求长期保留，不随注销删除。这部分记录只关联到内部编号，
          清除个人信息后无法再指向具体的你。
        </p>

        <h2 class="legal-h2">五、你的权利</h2>
        <p class="legal-p"><b>查看与更正：</b>在「我的 → 账号管理」里可以修改昵称与头像、修改登录密码。</p>
        <p class="legal-p"><b>查询账目：</b>在「积分明细」「投注记录」里可以导出与核对你的每一笔账。</p>
        <p class="legal-p">
          <b>注销账号：</b>在「我的 → 账号管理 → 注销账号」可自助注销。
          注销前请先把余额下分取回：<b>注销时账上剩余积分会立即清零且无法找回</b>，
          未领取的回水同时作废。注销后账号无法恢复，也不能再次注册。
        </p>

        <h2 class="legal-h2">六、未成年人</h2>
        <p class="legal-p">本应用不面向未满 18 周岁的用户。若发现未成年人注册，我们会关闭该账号。</p>

        <h2 class="legal-h2">七、联系我们</h2>
        <p class="legal-p">
          对本政策有疑问，或要求查询、更正、删除你的信息，请在应用内
          <b>「客服」</b>页与我们联系，客服会在工作时间内答复。
        </p>
      </div>

      <div class="lobby-spacer"></div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { useBodyClass } from '@/composables/useBodyClass'
import '@/assets/close-account.css'

useBodyClass('deco-bg')
const router = useRouter()

/* 运营主体；改这里即可，正文会跟着变 */
const OPERATOR = '澳门金御汇'
const UPDATED_AT = '2026-08-08'

const isPlaceholder = computed(() => OPERATOR.includes('待填'))
</script>
