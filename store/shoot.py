#!/usr/bin/env -S uv run --with websocket-client --script
# /// script
# dependencies = ["websocket-client"]
# ///
"""
Chrome Web Store screenshots without a logged-in browser: launch headless Chromium with the built extension
(.output/chrome-mv3), seed a demo hangar + buyback into chrome.storage, open hub views and capture 1280x800 PNGs
into store/screenshots/. Store catalog, paints and funding are fetched live (public). Run: `npm run build && store/shoot.py`
(optionally followed by shot names to re-take only those).
"""
import json, os, random, subprocess, sys, time, urllib.request
from datetime import date, timedelta
import websocket

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
EXT = os.path.join(ROOT, '.output', 'chrome-mv3')
OUT = os.path.join(ROOT, 'store', 'screenshots')
PROFILE = os.path.join(ROOT, 'store', '.profile')
PORT = 9333
W, H, DSF = 1280, 800, 2

# ---------------------------------------------------------------- demo data (no real account)
random.seed(7)
def day(y, m, d): return date(y, m, d).strftime('%B %d, %Y')
def pledge(id, name, value, when, type, items, ships, *, lti=False, ins='', wb=False, gift=True, melt=True, game=False, up=False, upgrade=None, nick=''):
    return dict(id=id, name=name, value=value, date=when, type=type, items=items, ships=ships, upgrade=upgrade, lti=lti,
                insurance=ins or ('LTI' if lti else ''), warbond=wb, giftable=gift, meltable=melt, hasGame=game, upgraded=up, nickname=nick, page=1 + id // 50)
S = lambda t: dict(title=t, kind='Ship')
P = lambda t: dict(title=t, kind='Paints')
I = lambda t, k='Item': dict(title=t, kind=k)
PLEDGES = [
    pledge(1, 'Aurora MR Starter Package', 45, day(2018, 11, 24), 'package', [S('Aurora MR'), I('Star Citizen Digital Download', 'Game'), I('Self-Land Hangar', 'Hangar'), I('6 Month Insurance', 'Insurance')], ['Aurora MR'], ins='6 mo', gift=False, game=True),
    pledge(2, 'Cutlass Black - Warbond', 100, day(2019, 11, 22), 'ship', [S('Cutlass Black'), I('Lifetime Insurance', 'Insurance')], ['Cutlass Black'], lti=True, wb=True, nick='Rusty'),
    pledge(3, 'Avenger Titan', 60, day(2020, 5, 23), 'ship', [S('Avenger Titan'), I('6 Month Insurance', 'Insurance')], ['Avenger Titan'], ins='6 mo'),
    pledge(4, 'Avenger Titan', 60, day(2020, 5, 23), 'ship', [S('Avenger Titan'), I('6 Month Insurance', 'Insurance')], ['Avenger Titan'], ins='6 mo'),
    pledge(5, 'Constellation Andromeda', 240, day(2020, 11, 27), 'ship', [S('Constellation Andromeda'), I('Lifetime Insurance', 'Insurance')], ['Constellation Andromeda'], lti=True, wb=True),
    pledge(6, 'Freelancer', 110, day(2021, 2, 14), 'ship', [S('Mercury Star Runner'), I('120 Month Insurance', 'Insurance')], ['Mercury Star Runner'], ins='120 mo', up=True, nick='Hermes'),
    pledge(7, 'Prospector', 155, day(2021, 11, 26), 'ship', [S('Prospector'), I('Lifetime Insurance', 'Insurance')], ['Prospector'], lti=True, wb=True),
    pledge(8, 'Vulture - Warbond', 140, day(2022, 5, 21), 'ship', [S('Vulture'), I('Lifetime Insurance', 'Insurance')], ['Vulture'], lti=True, wb=True),
    pledge(9, 'Carrack', 600, day(2022, 11, 25), 'ship', [S('Carrack'), I('Lifetime Insurance', 'Insurance')], ['Carrack'], lti=True, nick='Endurance'),
    pledge(10, '400i', 250, day(2023, 2, 10), 'ship', [S('400i'), I('120 Month Insurance', 'Insurance')], ['400i'], ins='120 mo'),
    pledge(11, 'Nomad', 80, day(2023, 5, 19), 'ship', [S('Nomad'), I('6 Month Insurance', 'Insurance')], ['Nomad'], ins='6 mo'),
    pledge(12, 'F7C Hornet Mk II', 175, day(2024, 2, 20), 'ship', [S('F7C Hornet Mk II'), I('Lifetime Insurance', 'Insurance')], ['F7C Hornet Mk II'], lti=True, wb=True),
    pledge(13, 'C2 Hercules Starlifter', 400, day(2024, 5, 24), 'ship', [S('C2 Hercules'), I('Lifetime Insurance', 'Insurance')], ['C2 Hercules'], lti=True),
    pledge(14, 'Arrow', 75, day(2024, 11, 22), 'ship', [S('Arrow'), I('120 Month Insurance', 'Insurance')], ['Arrow'], ins='120 mo', wb=True),
    pledge(15, 'C8X Pisces Expedition', 45, day(2025, 2, 14), 'ship', [S('C8X Pisces Expedition'), I('Lifetime Insurance', 'Insurance')], ['C8X Pisces Expedition'], lti=True),
    pledge(16, 'Zeus Mk II CL - Warbond', 150, day(2025, 11, 21), 'ship', [S('Zeus Mk II CL'), I('Lifetime Insurance', 'Insurance')], ['Zeus Mk II CL'], lti=True, wb=True),
    pledge(17, 'Upgrade - Avenger Titan to Arrow', 15, day(2024, 11, 22), 'upgrade', [I('Upgrade - Avenger Titan to Arrow', 'Upgrade')], [], upgrade=dict(fromId=None, fromName='Avenger Titan', toId=None, toName='Arrow')),
    pledge(18, 'Upgrade - Nomad to Cutlass Black - Warbond', 15, day(2025, 5, 23), 'upgrade', [I('Upgrade - Nomad to Cutlass Black', 'Upgrade')], [], wb=True, upgrade=dict(fromId=None, fromName='Nomad', toId=None, toName='Cutlass Black')),
    pledge(19, 'Upgrade - 400i to 600i Explorer', 225, day(2025, 11, 21), 'upgrade', [I('Upgrade - 400i to 600i Explorer', 'Upgrade')], [], upgrade=dict(fromId=None, fromName='400i', toId=None, toName='600i Explorer')),
    pledge(20, 'Cutlass - Coalfire Paint', 12, day(2021, 10, 29), 'paint', [P('Cutlass - Coalfire Paint')], []),
    pledge(21, 'Carrack - Polar Paint', 25, day(2022, 11, 25), 'paint', [P('Carrack - Polar Paint')], []),
    pledge(22, 'Mercury - Equinox Paint', 12, day(2023, 1, 20), 'paint', [P('Mercury - Equinox Paint')], []),
    pledge(23, 'Vulture - Carnival Paint', 10, day(2023, 1, 20), 'paint', [P('Vulture - Carnival Paint')], []),
    pledge(24, 'Nomad - Jackal Paint', 8, day(2023, 5, 19), 'paint', [P('Nomad - Jackal Paint')], []),
    pledge(25, 'Prospector - Nebula Paint', 12, day(2024, 5, 24), 'paint', [P('Prospector - Nebula Paint')], []),
    pledge(26, 'F7 Hornet Mk II - Blacksmith Paint', 12, day(2024, 2, 20), 'paint', [P('F7 Hornet Mk II - Blacksmith Paint')], []),
    pledge(27, 'Gladius - Frostbite Paint', 10, day(2024, 12, 20), 'paint', [P('Gladius - Frostbite Paint')], []),
    pledge(28, 'Zeus Mk II - Solar Paint', 12, day(2025, 12, 19), 'paint', [P('Zeus Mk II - Solar Paint')], []),
    pledge(35, '400i - Stratus Paint', 15, day(2023, 2, 10), 'paint', [P('400i - Stratus Paint')], []),
    pledge(29, 'IAE 2955 - Trophy Pack', 0, day(2025, 11, 21), 'other', [I('IAE 2955 Trophy'), I('IAE 2955 Hangar Flair', 'Hangar')], [], gift=False, melt=False),
    pledge(30, 'Luminalia 2955 - Snowflake Shield', 0, day(2025, 12, 20), 'other', [I('Luminalia 2955 Snowflake Shield', 'Hangar')], [], gift=False, melt=False),
    pledge(31, 'Subscriber Flair - Centurion', 0, day(2025, 10, 1), 'subscriber', [I('Centurion Subscriber Flair', 'Hangar')], [], gift=False, melt=False),
    pledge(32, 'Referral Rewards - Plushie', 0, day(2024, 6, 1), 'other', [I('Referral Reward Plushie', 'Hangar')], [], gift=False, melt=False),
    pledge(33, 'Pembroke RSI Armor Set', 5, day(2024, 11, 22), 'gear', [I('Pembroke RSI Armor', 'FPS Equipment')], []),
    pledge(34, 'Aegis Hangar Flair - Model Ship', 2, day(2022, 11, 25), 'hangar', [I('Aegis Hangar Flair Model', 'Hangar')], []),
]
HANGAR = dict(at=int(time.time() * 1000) - 3600_000, pledges=PLEDGES, complete=True, page=1, credits=dict(usd=185.5, uec=25000, rec=5000), creditsAt=int(time.time() * 1000) - 3600_000)
def bb(id, name, when, items, price, listp, type='ship', upgrade=None):
    return dict(id=id, name=name, date=when, contained=', '.join(i['title'] for i in items), items=items, price=price, listPrice=listp, sku=100000 + id, detailAt=HANGAR['at'], type=type, upgrade=upgrade, url=f'https://robertsspaceindustries.com/pledge/buyback/{id}')
BUYBACK = dict(at=HANGAR['at'], complete=True, page=1, items=[
    bb(501, 'Gladius', day(2021, 5, 21), [S('Gladius'), I('6 Month Insurance', 'Insurance')], 9000, 9000),
    bb(502, 'Hull A', day(2022, 2, 11), [S('Hull A'), I('6 Month Insurance', 'Insurance')], 9000, 9000),
    bb(503, 'Cutlass - Nightfall Paint', day(2022, 10, 28), [P('Cutlass - Nightfall Paint')], 1200, 1200, type='paint'),
    bb(504, 'Upgrade - Arrow to Gladius', day(2023, 11, 24), [I('Upgrade - Arrow to Gladius', 'Upgrade')], 1500, 1500, type='upgrade', upgrade=dict(fromId=None, fromName='Arrow', toId=None, toName='Gladius')),
    bb(505, 'Carrack - Stormbringer Paint', day(2023, 11, 24), [P('Carrack - Stormbringer Paint')], 2000, 2500, type='paint'),
    bb(506, 'Syulen', day(2024, 5, 24), [S('Syulen'), I('120 Month Insurance', 'Insurance')], 8000, 8000),
])
SEED = dict(hangar=HANGAR, buyback=BUYBACK)
WISH = [dict(id=62, name='Carrack', lowest=None), dict(id=116, name='Polaris', lowest=None)]

# ---------------------------------------------------------------- tiny CDP client
class CDP:
    def __init__(self, url):
        self.ws = websocket.create_connection(url, suppress_origin=True, timeout=60); self.n = 0
    def call(self, method, **params):
        self.n += 1; self.ws.send(json.dumps(dict(id=self.n, method=method, params=params)))
        while True:
            m = json.loads(self.ws.recv())
            if m.get('id') == self.n:
                if 'error' in m: raise RuntimeError(f'{method}: {m["error"]}')
                return m.get('result', {})
    def js(self, expr):
        r = self.call('Runtime.evaluate', expression=expr, awaitPromise=True, returnByValue=True)
        if 'exceptionDetails' in r: raise RuntimeError(json.dumps(r['exceptionDetails'])[:400])
        return r.get('result', {}).get('value')

def targets():
    return json.load(urllib.request.urlopen(f'http://127.0.0.1:{PORT}/json'))

def main():
    os.makedirs(OUT, exist_ok=True)
    subprocess.run(['rm', '-rf', PROFILE])
    chrome = subprocess.Popen([
        os.environ.get('CHROME', 'chromium'), '--headless=new', '--disable-gpu', '--hide-scrollbars', f'--remote-debugging-port={PORT}',
        f'--user-data-dir={PROFILE}', f'--load-extension={EXT}', f'--disable-extensions-except={EXT}', f'--window-size={W},{H}', f'--force-device-scale-factor={DSF}', 'about:blank',
    ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        ext = None
        for _ in range(60):
            time.sleep(0.5)
            try:
                for t in targets():
                    if t['url'].startswith('chrome-extension://'): ext = t['url'].split('/')[2]
            except Exception: pass
            if ext: break
        if not ext: sys.exit('extension never showed up in the target list')
        print('extension', ext)
        browser = CDP(json.load(urllib.request.urlopen(f'http://127.0.0.1:{PORT}/json/version'))['webSocketDebuggerUrl'])
        tid = browser.call('Target.createTarget', url=f'chrome-extension://{ext}/hub.html#settings')['targetId']
        time.sleep(1.5)
        page = CDP(next(t for t in targets() if t['id'] == tid)['webSocketDebuggerUrl'])
        page.call('Page.enable')
        page.call('Emulation.setDeviceMetricsOverride', width=W, height=H, deviceScaleFactor=DSF, mobile=False)
        page.js(f'chrome.storage.local.set({json.dumps(SEED)})')
        page.js(f'chrome.storage.sync.set({json.dumps(dict(wishlist=WISH))})')
        page.js("localStorage.setItem('rsiplus:wizard:paints','off'); localStorage.setItem('rsiplus:wizard:ccu','off'); 1")
        page.js("localStorage.setItem('rsiplus:hub:sidebar','open'); localStorage.setItem('rsiplus:theme', JSON.stringify({mode:'dark',accent:'cyan',dark:'rsi',light:'light'})); 'ok'")
        print('seeded')
        BTN = "(t) => [...document.querySelectorAll('button')].find((b) => b.innerText.trim().startsWith(t))"
        SLEEP = "(ms) => new Promise((r) => setTimeout(r, ms))"
        shots = [
            ('hangar', '#hangar', {'rsiplus:hangar': {'byShip': False, 'hiddenSets': []}}, None),
            ('hangar-by-ship', '#hangar', {'rsiplus:hangar': {'byShip': True, 'hiddenSets': []}}, None),
            ('melt-calculator', '#melt', {'rsiplus:hangar': {'byShip': False, 'hiddenSets': []}},
             f"(async () => {{ const btn = {BTN}, sleep = {SLEEP}; btn('Pick duplicates')?.click(); await sleep(300); btn('Pick paints without a ship')?.click(); await sleep(500); btn('Pick duplicates')?.scrollIntoView({{ block: 'start' }}); window.scrollBy(0, -70); }})()"),
            ('paint-rebuy', '#paint-rebuy', {}, None),
            ('ccu-planner', '#ccu', {},
             f"""(async () => {{ const sleep = {SLEEP};
               const pick = async (label, text) => {{ document.querySelector(`button[aria-label="${{label}}"]`)?.click(); await sleep(600); const inp = document.querySelector(`input[aria-label="${{label}}"]`); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(inp, text); inp.dispatchEvent(new Event('input', {{ bubbles: true }})); await sleep(700); const opt = [...document.querySelectorAll('[role=option]')].find((o) => o.innerText.trim().startsWith(text)); opt?.click(); await sleep(800); }};
               const cat = (await chrome.storage.local.get('catalog')).catalog; const t = cat.ships.filter((x) => x.ccu.length && x.msrp > 11000 && x.msrp <= 60000).sort((a, b) => b.msrp - a.msrp)[0];
               await pick('From ship', 'Cutlass Black'); if (t) await pick('Target ship', t.name); await sleep(2500);
               const el = [...document.querySelectorAll('span')].find((e) => e.innerText === 'to pay now'); (el?.closest('[data-slot=card]')?.parentElement ?? document.querySelector('fieldset, [role=group]'))?.scrollIntoView({{ block: 'start' }}); window.scrollBy(0, -240); return t?.name; }})()"""),
            ('ccu-ahead', '#ccu', {},
             f"""(async () => {{ const sleep = {SLEEP};
               const pick = async (label, text) => {{ document.querySelector(`button[aria-label="${{label}}"]`)?.click(); await sleep(600); const inp = document.querySelector(`input[aria-label="${{label}}"]`); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(inp, text); inp.dispatchEvent(new Event('input', {{ bubbles: true }})); await sleep(700); const opt = [...document.querySelectorAll('[role=option]')].find((o) => o.innerText.trim().startsWith(text)); opt?.click(); await sleep(800); }};
               [...document.querySelectorAll('label')].find((l) => /Plan ahead/.test(l.innerText))?.querySelector('button, [role=checkbox]')?.click(); await sleep(300);
               const cat = (await chrome.storage.local.get('catalog')).catalog; const t = cat.ships.filter((x) => !x.ccu.length && !x.standalone.some((k) => k.available) && x.msrp > 30000 && x.msrp <= 60000).sort((a, b) => b.msrp - a.msrp)[0];
               await pick('From ship', 'Cutlass Black'); if (t) await pick('Target ship', t.name); await sleep(2500);
               const el = [...document.querySelectorAll('span')].find((e) => e.innerText === 'to pay now'); (el?.closest('[data-slot=card]')?.parentElement ?? document.querySelector('fieldset, [role=group]'))?.scrollIntoView({{ block: 'start' }}); window.scrollBy(0, -240); return t?.name; }})()"""),
            ('wallet', '#wallet', {}, None),
            ('fan-footer', '#feed', {}, "window.scrollTo(0, document.body.scrollHeight); 1"),
            ('browse', '#browse', {}, f"(async () => {{ const sleep = {SLEEP}; for (let i = 0; i < 40 && !/listings · prices/.test(document.body.innerText); i++) await sleep(500); }})()"),
            ('store', '#store', {}, f"(async () => {{ const sleep = {SLEEP}; [...document.querySelectorAll('th button, th [role=button]')].find((b) => /Discount/.test(b.innerText))?.click(); await sleep(400); }})()"),
            ('ships', '#fleet', {}, None),
            ('ships-ingame', '#fleet', {},
             f"""(async () => {{ const sleep = {SLEEP};
               const cat = (await chrome.storage.local.get('catalog')).catalog; const by = (n) => cat.ships.find((x) => x.name === n);
               const g = [['Prospector', 'bought'], ['Cutlass Black', 'earned'], ['Arrow', 'bought']].map(([n, how]) => by(n) && {{ id: by(n).id, name: n, how, count: 1 }}).filter(Boolean);
               await chrome.storage.sync.set({{ gameShips: g }}); await sleep(1200);
               [...document.querySelectorAll('span')].find((e) => e.innerText === 'In-game ships')?.scrollIntoView({{ block: 'start' }}); window.scrollBy(0, -120); }})()"""),
            ('paints', '#paints', {}, None),
            ('buyback', '#buyback', {}, None),
        ]
        only = set(sys.argv[1:])  # `store/shoot.py ccu-planner wallet` re-takes just those
        for name, hash_, ls, prep in shots:
            if only and name not in only: continue
            for k, v in ls.items(): page.js(f'localStorage.setItem({json.dumps(k)}, {json.dumps(json.dumps(v))}); 1')
            page.js(f'location.hash = {json.dumps(hash_)}; location.reload(); 1')
            # wait for the panel to settle: no "Loading" text and no spinner for 2 consecutive polls, max ~25 s
            quiet = 0
            for _ in range(50):
                time.sleep(0.5)
                try:
                    busy = page.js("(() => { const t = document.body?.innerText || ''; return /Loading…|Loading\\.\\.\\.|Reading page/.test(t) || !!document.querySelector('.animate-spin'); })()")
                except Exception: busy = True
                quiet = 0 if busy else quiet + 1
                if quiet >= 4: break
            time.sleep(1)
            page.js("document.head.insertAdjacentHTML('beforeend', '<style>header [title=Accounts]{display:none}</style>'); window.scrollTo(0,0); 1")
            if prep:
                try: page.js(prep)
                except Exception as e: print('prep failed', name, str(e)[:200])
                time.sleep(1.5)
            data = page.call('Page.captureScreenshot', format='png', captureBeyondViewport=False)['data']
            raw = os.path.join(OUT, f'{name}.raw.png')
            open(raw, 'wb').write(__import__('base64').b64decode(data))
            final = os.path.join(OUT, f'{name}.png')
            subprocess.run(['magick', raw, '-resize', f'{W}x{H}!', '-alpha', 'remove', '-alpha', 'off', '-strip', final], check=True)
            os.remove(raw)
            print('shot', final)
    finally:
        chrome.terminate()
        try: chrome.wait(5)
        except Exception: chrome.kill()

if __name__ == '__main__':
    main()
