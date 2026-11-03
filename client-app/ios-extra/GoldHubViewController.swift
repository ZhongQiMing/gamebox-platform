/// 与安卓 MainActivity 对齐：长按不出复制条（含游戏网页），文字不跟系统字号单独放大。
class GoldHubViewController: CAPBridgeViewController {
    override func webView(with frame: CGRect, configuration: WKWebViewConfiguration) -> WKWebView {
        let source = """
        (function () {
          var css = 'html,body,body *{-webkit-text-size-adjust:100% !important;-webkit-user-select:none !important;user-select:none !important;-webkit-touch-callout:none !important}input,textarea,[contenteditable=true]{-webkit-user-select:text !important;user-select:text !important;-webkit-touch-callout:default !important}';
          var style = document.createElement('style');
          style.textContent = css;
          var root = document.documentElement;
          if (root) root.appendChild(style);
          function allow(e) {
            var t = e.target;
            return t && t.closest && t.closest('input, textarea, [contenteditable="true"]');
          }
          document.addEventListener('contextmenu', function (e) {
            if (allow(e)) return;
            e.preventDefault();
          }, true);
          document.addEventListener('selectstart', function (e) {
            if (allow(e)) return;
            e.preventDefault();
          }, true);
        })();
        """
        let script = WKUserScript(source: source, injectionTime: .atDocumentStart, forMainFrameOnly: false)
        configuration.userContentController.addUserScript(script)
        let view = super.webView(with: frame, configuration: configuration)
        view.allowsLinkPreview = false
        return view
    }
}
