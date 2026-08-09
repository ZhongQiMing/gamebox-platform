# -*- coding: utf-8 -*-
"""一次性脚手架：从 bjsc 复制出各游戏独立目录（非运行时共享）"""
import re
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / 'bjsc'
ELF_SRC = Path(r'C:\Users\pc\Desktop\精灵球')

PK10_GAMES = [
    {'dir': 'speed-boat', 'pfx': 'jsb', 'name': '幸运飞艇', 'title_spaced': '幸 运 飞 艇',
     'bet': 40, 'freeze': 15, 'draw': 5, 'issue': '3405', 'accent': '#4ec8e8'},
]

CHAT_GAMES = [
    {'dir': 'lhc', 'pfx': 'lhc', 'name': '六合彩', 'title_spaced': '六 合 彩',
     'bet': 40, 'freeze': 15, 'draw': 5, 'issue': '3406', 'type': 'lhc'},
    {'dir': 'zhajinhua', 'pfx': 'zjh', 'name': '炸金花', 'title_spaced': '炸 金 花',
     'bet': 40, 'freeze': 15, 'draw': 5, 'issue': '3407', 'type': 'card3'},
    {'dir': 'douniu', 'pfx': 'dn', 'name': '斗牛', 'title_spaced': '斗 牛',
     'bet': 40, 'freeze': 15, 'draw': 5, 'issue': '3408', 'type': 'card5'},
    {'dir': 'baccarat', 'pfx': 'bjl', 'name': '百家乐', 'title_spaced': '百 家 乐',
     'bet': 40, 'freeze': 15, 'draw': 5, 'issue': '3409', 'type': 'baccarat'},
    {'dir': 'ffc', 'pfx': 'ffc', 'name': '分分彩', 'title_spaced': '分 分 彩',
     'bet': 40, 'freeze': 15, 'draw': 5, 'issue': '3410', 'type': 'digit5'},
    {'dir': 'kuai3', 'pfx': 'k3', 'name': '1分快三', 'title_spaced': '1 分 快 三',
     'bet': 40, 'freeze': 15, 'draw': 5, 'issue': '3411', 'type': 'dice3'},
    {'dir': 'ssc', 'pfx': 'ssc', 'name': '时时彩', 'title_spaced': '时 时 彩',
     'bet': 480, 'freeze': 90, 'draw': 30, 'issue': '3412', 'type': 'digit5'},
]

SLOT_GAMES = [
    {'dir': 'queen', 'pfx': 'qn', 'name': '赏金女王', 'title_spaced': '赏 金 女 王'},
    {'dir': 'slots', 'pfx': 'slt', 'name': '老虎机', 'title_spaced': '老 虎 机'},
    {'dir': 'longhu', 'pfx': 'lhd', 'name': '龙虎斗', 'title_spaced': '龙 虎 斗'},
]


def replace_all(text, old, new):
    return text.replace(old, new)


def fork_pk10(cfg):
    dst = ROOT / cfg['dir']
    if dst.exists():
        shutil.rmtree(dst)
    shutil.copytree(SRC, dst, ignore=shutil.ignore_patterns('scripts', 'numbers.svg', 'pk10-balls-sheet.png'))
    pfx = cfg['pfx']
    # rename files
    (dst / 'css' / 'bjsc.css').rename(dst / 'css' / f'{pfx}.css')
    (dst / 'js' / 'bjsc.js').rename(dst / 'js' / f'{pfx}.js')

    for fp in [dst / 'index.html', dst / 'css' / f'{pfx}.css', dst / 'js' / f'{pfx}.js']:
        t = fp.read_text(encoding='utf-8')
        t = t.replace('bjsc', pfx)
        t = t.replace('北京赛车', cfg['name'])
        t = t.replace('北 京 赛 车', cfg['title_spaced'])
        t = t.replace('./css/bjsc.css', f'./css/{pfx}.css')
        t = t.replace('./js/bjsc.js', f'./js/{pfx}.js')
        if 'accent' in cfg and fp.suffix == '.css':
            t = t.replace(
                'background: linear-gradient(180deg, #fff8e0 0%, var(--gold) 55%, var(--gold-deep) 100%);',
                f'background: linear-gradient(180deg, #e8f8ff 0%, {cfg["accent"]} 55%, #1a5a78 100%);'
            )
        fp.write_text(t, encoding='utf-8')

    js = dst / 'js' / f'{pfx}.js'
    t = js.read_text(encoding='utf-8')
    t = re.sub(
        r"const BET_SEC = \d+;(?:\s*//[^\n]*)?\s*\n\s*const FREEZE_SEC = \d+;(?:\s*//[^\n]*)?\s*\n\s*const DRAW_SEC = \d+;(?:\s*//[^\n]*)?\s*\n\s*const INTERVAL = BET_SEC \+ FREEZE_SEC \+ DRAW_SEC;(?:\s*//[^\n]*)?",
        f"const BET_SEC = {cfg['bet']};\n  const FREEZE_SEC = {cfg['freeze']};\n  const DRAW_SEC = {cfg['draw']};\n  const INTERVAL = BET_SEC + FREEZE_SEC + DRAW_SEC;",
        t, count=1
    )
    t = t.replace("'3403'", f"'{cfg.get('issue', '3403')}'")
    t = t.replace("return '3403' + pad", f"return '{cfg.get('issue', '3403')}' + pad")
    js.write_text(t, encoding='utf-8')
    print('pk10', cfg['dir'])


def fork_chat(cfg):
    fork_pk10({**cfg, 'accent': '#d4af37'})
    dst = ROOT / cfg['dir']
    pfx = cfg['pfx']
    # write type marker in js
    js = dst / 'js' / f'{pfx}.js'
    t = js.read_text(encoding='utf-8')
    t = t.replace('/**', f"/**\n * 游戏类型: {cfg['type']}\n *", 1)
    marker = f"const GAME_TYPE = '{cfg['type']}';\n"
    if 'GAME_TYPE' not in t:
        t = t.replace('$(function () {', f'$(function () {{\n  {marker}', 1)
    js.write_text(t, encoding='utf-8')

    if cfg['type'] == 'lhc':
        copy_elf_balls(dst)
        patch_lhc_html(dst, pfx)
    elif cfg['type'] == 'digit5':
        patch_digit_html(dst, pfx)
    elif cfg['type'] == 'dice3':
        patch_dice_html(dst, pfx)
    elif cfg['type'] in ('card3', 'card5', 'baccarat'):
        patch_card_html(dst, pfx, cfg['type'])
    print('chat', cfg['dir'])


def copy_elf_balls(dst):
    balls = dst / 'assets' / 'balls'
    if balls.exists():
        shutil.rmtree(balls)
    balls.mkdir(parents=True)
    if ELF_SRC.exists():
        for i in range(1, 50):
            src = ELF_SRC / f'ball_{i:02d}.png'
            if src.exists():
                shutil.copy2(src, balls / f'ball_{i:02d}.png')


def patch_lhc_html(dst, pfx):
    html = (dst / 'index.html').read_text(encoding='utf-8')
    html = html.replace('冠亚和 —', '特码 —')
    html = html.replace('<col class="col-ball" span="10">', '<col class="col-ball" span="7">')
    old_th = '''<th>一</th><th>二</th><th>三</th><th>四</th><th>五</th>
              <th>六</th><th>七</th><th>八</th><th>九</th><th>十</th>
              <th>冠亚</th>
              <th>龙虎</th>'''
    new_th = '''<th>1</th><th>2</th><th>3</th><th>4</th><th>5</th><th>6</th>
              <th>特</th>
              <th>总和</th>
              <th>色波</th>'''
    html = html.replace(old_th, new_th)
    (dst / 'index.html').write_text(html, encoding='utf-8')


def patch_digit_html(dst, pfx):
    html = (dst / 'index.html').read_text(encoding='utf-8')
    html = html.replace('冠亚和 —', '五星和 —')
    html = html.replace('<col class="col-ball" span="10">', '<col class="col-ball" span="5">')
    old_th = '''<th>一</th><th>二</th><th>三</th><th>四</th><th>五</th>
              <th>六</th><th>七</th><th>八</th><th>九</th><th>十</th>
              <th>冠亚</th>
              <th>龙虎</th>'''
    new_th = '''<th>万</th><th>千</th><th>百</th><th>十</th><th>个</th>
              <th>和值</th>
              <th>形态</th>'''
    html = html.replace(old_th, new_th)
    (dst / 'index.html').write_text(html, encoding='utf-8')


def patch_dice_html(dst, pfx):
    html = (dst / 'index.html').read_text(encoding='utf-8')
    html = html.replace('冠亚和 —', '和值 —')
    html = html.replace('<col class="col-ball" span="10">', '<col class="col-ball" span="3">')
    old_th = '''<th>一</th><th>二</th><th>三</th><th>四</th><th>五</th>
              <th>六</th><th>七</th><th>八</th><th>九</th><th>十</th>
              <th>冠亚</th>
              <th>龙虎</th>'''
    new_th = '''<th>骰1</th><th>骰2</th><th>骰3</th>
              <th>和值</th>
              <th>形态</th>'''
    html = html.replace(old_th, new_th)
    (dst / 'index.html').write_text(html, encoding='utf-8')


def patch_card_html(dst, pfx, gtype):
    html = (dst / 'index.html').read_text(encoding='utf-8')
    html = html.replace('id="barBalls"', 'id="barBalls" class="bar-cards"')
    html = html.replace('冠亚和 —', '牌型 —')
    html = html.replace('<col class="col-ball" span="10">', '<col class="col-ball" span="3">' if gtype == 'card3' else '<col class="col-ball" span="5">')
    if gtype == 'card3':
        th = '''<th>牌1</th><th>牌2</th><th>牌3</th><th>牌型</th><th>点数</th>'''
    elif gtype == 'card5':
        th = '''<th>牌1</th><th>牌2</th><th>牌3</th><th>牌4</th><th>牌5</th><th>牛数</th><th>大小</th>'''
    else:
        th = '''<th>庄</th><th>闲</th><th>结果</th><th>庄对</th><th>闲对</th>'''
    old_th = '''<th>一</th><th>二</th><th>三</th><th>四</th><th>五</th>
              <th>六</th><th>七</th><th>八</th><th>九</th><th>十</th>
              <th>冠亚</th>
              <th>龙虎</th>'''
    html = html.replace(old_th, th)
    (dst / 'index.html').write_text(html, encoding='utf-8')


def write_slot_game(cfg):
    dst = ROOT / cfg['dir']
    if dst.exists():
        shutil.rmtree(dst)
    (dst / 'css').mkdir(parents=True)
    (dst / 'js').mkdir(parents=True)
    pfx = cfg['pfx']
    name = cfg['name']
    sp = cfg['title_spaced']
    (dst / 'index.html').write_text(f'''<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover">
  <title>{name}</title>
  <link rel="stylesheet" href="../../client-app/assets/css/common.css">
  <link rel="stylesheet" href="./css/{pfx}.css">
</head>
<body class="{pfx}-body {pfx}-bg">
<div class="{pfx}-room">
  <header class="{pfx}-head">
    <button type="button" class="{pfx}-back" id="backBtn" aria-label="返回"></button>
    <h1 class="{pfx}-title">{sp}</h1>
    <div class="{pfx}-bal">积分 <span id="statBalance">0</span></div>
  </header>
  <main class="{pfx}-stage" id="gameStage">
    <div class="{pfx}-screen">
      <p class="{pfx}-hint">单机试玩 · 点击开始</p>
      <div class="{pfx}-display" id="gameDisplay">—</div>
    </div>
  </main>
  <footer class="{pfx}-bar">
    <button type="button" class="{pfx}-btn" id="btnPlay">开始游戏</button>
    <button type="button" class="{pfx}-btn {pfx}-btn--gold" id="btnBet">下注 100</button>
  </footer>
</div>
<script src="/legacy/js/jquery-3.7.1.min.js"></script>
<script src="../../client-app/assets/js/common.js"></script>
<script src="./js/{pfx}.js"></script>
</body>
</html>''', encoding='utf-8')
    (dst / 'css' / f'{pfx}.css').write_text(SLOT_CSS.replace('{{pfx}}', pfx), encoding='utf-8')
    (dst / 'js' / f'{pfx}.js').write_text(SLOT_JS.replace('{{pfx}}', pfx).replace('{{name}}', name), encoding='utf-8')
    print('slot', cfg['dir'])


SLOT_CSS = '''body.{{pfx}}-body{{margin:0;overflow:hidden;background:var(--bg-dark);color:var(--text);}}
.{{pfx}}-room{{display:flex;flex-direction:column;height:100dvh;width:100%;background:rgba(13,10,8,.85);}}
.{{pfx}}-head{{display:flex;align-items:center;gap:10px;padding:calc(8px + env(safe-area-inset-top,0px)) 12px 8px;border-bottom:1px solid rgba(212,175,55,.2);}}
.{{pfx}}-back{{width:36px;height:36px;border:none;background:transparent url('../../../client-app/assets/images/back-button.svg') center/contain no-repeat;}}
.{{pfx}}-title{{flex:1;margin:0;font-size:17px;letter-spacing:3px;color:var(--gold);font-family:'Noto Serif SC',serif;}}
.{{pfx}}-bal{{font-size:12px;color:var(--text-dim);}}
.{{pfx}}-bal span{{color:var(--gold-bright);font-weight:600;}}
.{{pfx}}-stage{{flex:1;display:flex;align-items:center;justify-content:center;padding:20px;}}
.{{pfx}}-screen{{width:100%;max-width:360px;text-align:center;padding:24px;border-radius:12px;border:1px solid rgba(212,175,55,.25);background:linear-gradient(145deg,rgba(34,26,16,.96),rgba(22,17,11,.98));box-shadow:var(--shadow-soft);}}
.{{pfx}}-hint{{font-size:13px;color:var(--text-muted);margin:0 0 16px;}}
.{{pfx}}-display{{font-size:28px;font-weight:700;color:var(--gold-bright);min-height:48px;line-height:48px;}}
.{{pfx}}-bar{{display:flex;gap:10px;padding:12px;padding-bottom:calc(12px + env(safe-area-inset-bottom,0px));border-top:1px solid rgba(212,175,55,.2);}}
.{{pfx}}-btn{{flex:1;height:44px;border-radius:8px;border:1px solid rgba(212,175,55,.35);background:rgba(0,0,0,.35);color:var(--text);font-size:15px;cursor:pointer;}}
.{{pfx}}-btn--gold{{background:linear-gradient(145deg,rgba(244,211,107,.35),rgba(138,111,31,.45));color:#fff8e8;font-weight:600;}}
'''

SLOT_JS = '''$(function(){
  const user=App.getUser();
  const params=new URLSearchParams(location.search);
  const q=params.get('roomNo')?('?roomNo='+encodeURIComponent(params.get('roomNo'))):'';
  const SYMBOLS={queen:'👑 💎 🏺 ⚔️ 🌙'.split(' '),slots:'7️⃣ 🍒 🔔 ⭐ 💎'.split(' ')}['{{pfx}}'.replace('qn','queen').replace('slt','slots')]||['★','◆','●'];
  function refresh(){$('#statBalance').text(App.getBalance(user.uid).toLocaleString('en-US'));}
  refresh();
  $('#backBtn').on('click',()=>App.go('../../client-app/pages/game-lobby/game-lobby.html'+q));
  $('#btnPlay').on('click',function(){
    const a=SYMBOLS[Math.floor(Math.random()*SYMBOLS.length)];
    const b=SYMBOLS[Math.floor(Math.random()*SYMBOLS.length)];
    const c=SYMBOLS[Math.floor(Math.random()*SYMBOLS.length)];
    $('#gameDisplay').text(a+' '+b+' '+c);
  });
  $('#btnBet').on('click',function(){
    const bal=App.getBalance(user.uid);
    if(bal<100){App.toast('积分不足');return;}
    App.setBalance(user.uid,bal-100);
    const win=Math.random()>0.55;
    if(win)App.setBalance(user.uid,App.getBalance(user.uid)+198);
    App.toast(win?'恭喜中奖 +198':'未中，再接再厉');
    refresh();
  });
});
'''


if __name__ == '__main__':
    for g in PK10_GAMES:
        fork_pk10(g)
    for g in CHAT_GAMES:
        fork_chat(g)
    for g in SLOT_GAMES:
        write_slot_game(g)
    print('done')
