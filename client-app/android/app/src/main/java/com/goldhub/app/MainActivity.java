package com.goldhub.app;

import android.os.Bundle;
import android.webkit.WebSettings;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

  /**
   * WebView 的两项缩放设置。缺一项，index.html 里那句固定宽度的视口声明就是白写的。
   *
   * 1) setUseWideViewPort(true)
   *    安卓 WebView 这一项默认是 false，此时它**直接忽略** viewport meta 里的 width，
   *    一律按设备自身宽度排版。界面是照设计稿宽度写死 px 的，落到 360dp 的机器上每个元素
   *    都超额占位，功能格子会溢出到卡片外面。打开之后 width=430 才会被采纳。
   *
   * 2) setLoadWithOverviewMode(true)
   *    按 430 排完版后，还要让 WebView 缩到屏宽显示，否则右边会被裁掉、能横向拖动。
   *    这一项负责「整页缩放到刚好铺满宽度」，也就是等比缩放真正发生的地方。
   *
   * 3) setTextZoom(100)
   *    WebView 默认跟随系统「字体大小」放大文字，但只放大文字、不放大装文字的盒子。
   *    牌桌、转盘、开奖球都是固定像素排版，文字单独变大就会顶破按钮、挤掉金额位数。
   *    缩放统一由上面两项负责，系统这层额外放大关掉。
   */
  @Override
  public void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);

    if (this.bridge != null && this.bridge.getWebView() != null) {
      WebSettings settings = this.bridge.getWebView().getSettings();
      settings.setUseWideViewPort(true);
      settings.setLoadWithOverviewMode(true);
      settings.setTextZoom(100);
      /* 壳是 App，不要跟网页一样拦自动播放，否则进游戏还要点一下才有 BGM */
      settings.setMediaPlaybackRequiresUserGesture(false);
    }
  }
}
