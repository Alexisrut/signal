"""Сборка трех руководств: общий каркас + контент по ролям."""
import base64, html, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
SHOTS = os.path.join(HERE, 'shots')
OUT = os.path.join(HERE, 'out')      # тело страницы для Artifact (без doctype/head/body)
DIST = os.path.join(HERE, 'dist')    # автономные HTML-файлы
os.makedirs(OUT, exist_ok=True)
os.makedirs(DIST, exist_ok=True)

CSS = open(os.path.join(HERE, 'style.css'), encoding='utf-8').read()
JS = open(os.path.join(HERE, 'script.js'), encoding='utf-8').read()

_img_cache = {}
def img_src(name):
    if name not in _img_cache:
        with open(os.path.join(SHOTS, name + '.webp'), 'rb') as f:
            _img_cache[name] = 'data:image/webp;base64,' + base64.b64encode(f.read()).decode('ascii')
    return _img_cache[name]

def esc(s):
    return html.escape(s, quote=True)

_used = set()
PLACEHOLDER = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'
def img_tag(name, alt=''):
    """Первое вхождение несет base64, повторные — только ключ: скрипт скопирует src."""
    if name in _used:
        return f'<img src="{PLACEHOLDER}" data-img="{name}" alt="{esc(alt)}">'
    _used.add(name)
    return f'<img src="{img_src(name)}" data-key="{name}" alt="{esc(alt)}">'

# ------------------------------------------------------------------ компоненты

def shot(name, url='', who='', cap='', mobile=False, clip=False, alt=''):
    cls = 'shot'
    if mobile: cls += ' shot--mobile'
    if clip: cls += ' shot--clip'
    bar = ''
    if not mobile:
        bar = f'<div class="shot__bar"><i></i><i></i><i></i><span class="shot__url">{esc(url)}</span><span class="shot__who">{esc(who)}</span></div>'
    else:
        bar = f'<div class="shot__bar"><span class="shot__who">{esc(who or url)}</span></div>'
    capx = f'<figcaption class="shot__cap">{cap}</figcaption>' if cap else ''
    return (f'<figure class="{cls} reveal"><div class="shot__frame">{bar}'
            f'{img_tag(name, alt or cap_text(cap))}</div>{capx}</figure>')

def shots_mobile(items, cap=''):
    frames = ''
    for name, who in items:
        frames += f'<div class="shot__frame"><div class="shot__bar"><span class="shot__who">{esc(who)}</span></div>{img_tag(name, who)}</div>'
    capx = f'<figcaption class="shot__cap" style="grid-column:1/-1">{cap}</figcaption>' if cap else ''
    return f'<figure class="shot shot--mobile reveal">{frames}{capx}</figure>'

def cap_text(cap):
    import re
    return re.sub('<[^>]+>', '', cap)[:120]

def scenario(title, steps, step_ms=5200):
    """steps: list of dict(t, d, img, text)."""
    lis = ''
    panes = ''
    for i, s in enumerate(steps):
        lis += (f'<li><div class="step"><span class="step__n">{i+1}</span><div><div class="step__t">{s["t"]}</div>'
                f'<div class="step__d">{s.get("d","")}</div></div><span class="step__bar"><i></i></span></div></li>')
        imgx = f'<div class="stage__img">{img_tag(s["img"], s["t"])}</div>' if s.get('img') else ''
        panes += f'<div class="stage__pane">{imgx}<div class="stage__txt">{s.get("text","")}</div></div>'
    return (f'<div class="scenario reveal" data-step-ms="{step_ms}"><div class="scenario__head"><div class="scenario__title">{title}</div>'
            f'<div class="scenario__ctl"><button type="button" data-prev title="Назад">‹</button><button type="button" data-play title="Пауза">❚❚</button>'
            f'<button type="button" data-next title="Вперед">›</button></div></div>'
            f'<div class="scenario__body"><ol class="steps">{lis}</ol><div class="stage">{panes}</div></div></div>')

def note(body, kind=''):
    k = f' note--{kind}' if kind else ''
    return f'<div class="note{k} reveal"><div class="note__body">{body}</div></div>'

def zones(items):
    lis = ''.join(f'<li><i>{i+1}</i><div><b>{t}</b><span>{d}</span></div></li>' for i, (t, d) in enumerate(items))
    return f'<ul class="zones stagger">{lis}</ul>'

def yes_no(yes, no, yes_title='Может', no_title='Не может'):
    y = ''.join(f'<li>{x}</li>' for x in yes)
    n = ''.join(f'<li>{x}</li>' for x in no)
    return (f'<div class="split reveal"><div class="card card--yes"><h4>{yes_title}</h4><ul>{y}</ul></div>'
            f'<div class="card card--no"><h4>{no_title}</h4><ul>{n}</ul></div></div>')

def table(headers, rows, compact=False, cls=''):
    th = ''.join(f'<th>{h}</th>' for h in headers)
    trs = ''
    for r in rows:
        trs += '<tr>' + ''.join(f'<td>{c}</td>' for c in r) + '</tr>'
    c = ' tbl--compact' if compact else ''
    return f'<div class="tbl-wrap reveal"><table class="{cls}{c}"><thead><tr>{th}</tr></thead><tbody>{trs}</tbody></table></div>'

CHK = '<span class="chk">✓</span>'
NO = '<span class="no">–</span>'
PART = '<span class="part" title="частично"></span>'

def matrix(rows, roles=('Подрядчик', 'Администратор', 'Руководитель', 'Главный админ')):
    th = '<th>Действие</th>' + ''.join(f'<th class="c role">{r}</th>' for r in roles)
    trs = ''
    for r in rows:
        cells = ''.join(f'<td class="c">{c}</td>' for c in r[1:])
        trs += f'<tr><td>{r[0]}</td>{cells}</tr>'
    return f'<div class="tbl-wrap"><table class="matrix tbl--compact"><thead><tr>{th}</tr></thead><tbody>{trs}</tbody></table></div>'

def endpoints(items):
    rows = ''
    for m, path, who in items:
        cls = {'GET': 'get', 'POST': 'post', 'PUT': 'put', 'DELETE': 'del'}[m]
        rows += f'<div class="ep"><span class="m m--{cls}">{m}</span><code>{esc(path)}</code><span class="w">{who}</span></div>'
    return f'<div class="ep-list reveal">{rows}</div>'

def defs(items):
    rows = ''.join(f'<div><dt>{k}</dt><dd>{v}</dd></div>' for k, v in items)
    return f'<dl class="defs reveal">{rows}</dl>'

def menu(items):
    out = ''
    for it in items:
        if isinstance(it, tuple):
            label, badge = it
            b = f'<b>{badge}</b>' if badge else ''
            out += f'<span>{label}{b}</span>'
        else:
            out += f'<span class="is-off">{it}</span>'
    return f'<div class="menu stagger">{out}</div>'

def section(n, sid, title, lead='', body='', dev=False):
    devc = ' dev' if dev else ''
    devt = '<span class="dev-tag">для разработчика</span>' if dev else ''
    leadx = f'<p class="section__lead">{lead}</p>' if lead else ''
    return (f'<section class="section{devc}" id="{sid}"><div class="section__head"><span class="section__n">{n:02d}</span>'
            f'<h2>{title}{devt}</h2></div>{leadx}{body}</section>')

def fsm():
    return '''<div class="fsm">
<svg viewBox="0 0 760 326" role="img" aria-label="Схема переходов статусов сигнала">
  <defs>
    <marker id="arr-line" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" style="fill:var(--line-2)"/></marker>
    <marker id="arr-red" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" style="fill:var(--red)"/></marker>
    <marker id="arr-green" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" style="fill:var(--green)"/></marker>
    <marker id="arr-gray" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" style="fill:var(--gray)"/></marker>
    <marker id="arr-blue" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" style="fill:var(--blue)"/></marker>
  </defs>
  <g style="color: var(--line-2)">
    <path id="e-start" class="edge" d="M 70 70 H 128" marker-end="url(#arr-line)"/>
  </g>
  <g style="color: var(--red)">
    <path id="e-yr" class="edge edge--sys" d="M 272 70 H 488" marker-end="url(#arr-red)"/>
  </g>
  <g style="color: var(--green)">
    <path class="edge edge--green" d="M 200 97 C 200 150 250 160 275 203" marker-end="url(#arr-green)"/>
    <path class="edge edge--green" d="M 540 97 C 540 150 400 160 325 203" marker-end="url(#arr-green)"/>
  </g>
  <g style="color: var(--gray)">
    <path class="edge edge--gray" d="M 235 97 C 260 150 400 170 445 203" marker-end="url(#arr-gray)"/>
    <path class="edge edge--gray" d="M 565 97 C 565 150 520 165 500 203" marker-end="url(#arr-gray)"/>
  </g>
  <g style="color: var(--blue)">
    <path class="edge edge--reopen" d="M 262 257 C 110 300 80 150 130 92" marker-end="url(#arr-blue)"/>
    <path class="edge edge--reopen" d="M 512 257 C 690 300 700 150 620 92" marker-end="url(#arr-blue)"/>
  </g>

  <circle cx="45" cy="70" r="22" class="node node--start"/>
  <text x="45" y="66" text-anchor="middle" class="sub">созда-</text>
  <text x="45" y="78" text-anchor="middle" class="sub">ние</text>

  <rect x="130" y="43" width="140" height="54" rx="12" class="node node--yellow"/>
  <text x="200" y="66" text-anchor="middle" class="lbl">Желтый</text>
  <text x="200" y="83" text-anchor="middle" class="sub">Новая проблема</text>

  <rect x="490" y="43" width="150" height="54" rx="12" class="node node--red"/>
  <text x="565" y="66" text-anchor="middle" class="lbl">Красный</text>
  <text x="565" y="83" text-anchor="middle" class="sub">Критичная проблема</text>

  <rect x="215" y="203" width="180" height="54" rx="12" class="node node--green"/>
  <text x="305" y="226" text-anchor="middle" class="lbl">Зеленый</text>
  <text x="305" y="243" text-anchor="middle" class="sub">Проблема решена · терминальный</text>

  <rect x="405" y="203" width="160" height="54" rx="12" class="node node--gray"/>
  <text x="485" y="226" text-anchor="middle" class="lbl">Серый</text>
  <text x="485" y="243" text-anchor="middle" class="sub">Отклонен · терминальный</text>

  <rect x="300" y="18" width="160" height="34" rx="8" class="who"/>
  <text x="380" y="32" text-anchor="middle" class="who-t">через 48 ч — Система,</text>
  <text x="380" y="45" text-anchor="middle" class="who-t">раньше — сотрудник вручную</text>

  <rect x="150" y="128" width="92" height="20" rx="6" class="who"/>
  <text x="196" y="142" text-anchor="middle" class="who-t">автор / сотрудник</text>
  <rect x="470" y="128" width="72" height="20" rx="6" class="who"/>
  <text x="506" y="142" text-anchor="middle" class="who-t">сотрудник</text>

  <rect x="120" y="278" width="520" height="36" rx="8" class="who"/>
  <text x="380" y="293" text-anchor="middle" class="who-t">синий пунктир — возобновление: сотрудник возвращает закрытый сигнал</text>
  <text x="380" y="307" text-anchor="middle" class="who-t">в статус, из которого его закрыли; время паузы вычитается из времени решения</text>

  <circle r="5" class="dot"><animateMotion dur="3.2s" repeatCount="indefinite" begin="0.6s"><mpath href="#e-yr"/></animateMotion></circle>
  <circle r="4" class="dot"><animateMotion dur="2.4s" repeatCount="indefinite"><mpath href="#e-start"/></animateMotion></circle>
</svg>
<div class="fsm__legend"><span><i class="l-sys"></i>эскалация в Красный</span><span><i class="l-green"></i>решение</span><span><i class="l-gray"></i>отклонение</span><span><i class="l-reopen"></i>возобновление</span></div>
</div>'''

def clock(text):
    return f'''<div class="clock reveal">
<svg viewBox="0 0 120 120" aria-hidden="true">
  <circle class="clock__ring" cx="60" cy="60" r="48"/>
  <circle class="clock__arc" cx="60" cy="60" r="48"/>
  <text x="60" y="58" text-anchor="middle" class="clock__t">48 ч</text>
  <text x="60" y="76" text-anchor="middle" class="clock__s">ПОРОГ</text>
</svg><p>{text}</p></div>'''

# ------------------------------------------------------------------ страница

ROLE_META = {
    'superadmin': dict(label='Главный администратор', sib='super'),
    'admin': dict(label='Администратор и руководитель', sib='admin'),
    'contractor': dict(label='Подрядчик', sib='contractor'),
}

import json
_links = {}
if os.path.exists(os.path.join(HERE, 'links.json')):
    _links = json.load(open(os.path.join(HERE, 'links.json'), encoding='utf-8'))
SIBLINGS_LINKS = [
    ('super', 'Главный администратор', 'Распределение, кураторы, учетные записи', _links.get('super')),
    ('admin', 'Администратор и руководитель', 'Карта сигналов, статусы, отчеты', _links.get('admin')),
    ('contractor', 'Подрядчик', 'Как подать и отслеживать сигнал', _links.get('contractor')),
]

def page(role, title, description, hero_html, toc, sections_html, sibling_links=None):
    toc_html = ''.join(
        f'<li><a href="#{sid}" class="{"toc--dev" if dev else ""}"><span class="toc__n">{n:02d}</span><span>{t}</span></a></li>'
        for n, sid, t, dev in toc)
    sibs = ''
    if sibling_links:
        cards = ''
        for key, name, sub, url in sibling_links:
            if key == ROLE_META[role]['sib'] or not url: continue
            cards += f'<a class="sib sib--{key}" href="{esc(url)}"><small>Руководство</small><b>{name}</b><div style="font-size:12.5px;color:var(--ink-3);margin-top:4px">{sub}</div></a>'
        if cards:
            sibs = f'<div class="siblings">{cards}</div>'
    return f'''<title>{esc(title)}</title>
<meta name="description" content="{esc(description)}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Unbounded:wght@600;700&family=Golos+Text:wght@400;500;600&family=JetBrains+Mono:wght@400;600&display=swap">
<style>{CSS}</style>
<script>document.documentElement.setAttribute('data-role','{role}');</script>
<div class="wrap">
<header class="top">
  <div class="brandline"><span class="brandline__mark"></span><span><b>Мониторинг сигналов</b> · руководство по эксплуатации</span></div>
  <div class="top__meta"><span>Роль: <b style="color:var(--ink)">{ROLE_META[role]['label']}</b></span><button type="button" class="theme-btn" data-theme-toggle>Тема</button></div>
</header>
{hero_html}
<div class="layout">
  <aside class="rail">
    <p class="rail__title">Содержание</p>
    <ol class="toc">{toc_html}</ol>
    <div class="rail__foot">Скриншоты сняты с демо-базы, имена и сигналы вымышленные. <b>Клик по снимку</b> открывает его крупно.</div>
  </aside>
  <main class="content">
    {sections_html}
    {sibs}
    <footer class="foot"><span>Мониторинг сигналов · руководство для роли «{ROLE_META[role]['label']}»</span><span>Составлено по исходному коду версии от сентября 2026</span></footer>
  </main>
</div>
</div>
<script>{JS}</script>
'''

def write(role, html_text):
    """Две версии: тело для публикации как Artifact и автономный файл с полным каркасом."""
    path = os.path.join(OUT, f'guide-{role}.html')
    with open(path, 'w', encoding='utf-8') as f:
        f.write(html_text)
    dist = os.path.join(DIST, f'guide-{role}.html')
    with open(dist, 'w', encoding='utf-8') as f:
        f.write('<!doctype html>\n<html lang="ru">\n<head>\n<meta charset="utf-8">\n'
                '<meta name="viewport" content="width=device-width, initial-scale=1">\n'
                '<style>body{margin:0}img{max-width:100%}[hidden]{display:none!important}</style>\n</head>\n<body>\n'
                + html_text + '\n</body>\n</html>\n')
    print(role, f'{os.path.getsize(dist)/1024/1024:.2f} MB', dist)
    # Следующая страница начинает учет скриншотов заново: base64 должен быть
    # в каждом файле — иначе при сборке всех трех подряд картинки ссылались бы
    # на ключ из другой страницы.
    _used.clear()
    return path
