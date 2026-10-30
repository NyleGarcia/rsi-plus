# RSI+ Privacy Policy

_Last updated: 2026-10-29_

RSI+ is a browser extension that improves the Roberts Space Industries website (Spectrum, hangar, buyback, pledge store). It runs entirely in your browser. There is no RSI+ server, account, or analytics. It talks only to RSI, and to StarOrg Tools if you connect it.

## What the extension accesses

- **Roberts Space Industries (robertsspaceindustries.com) — the only site it talks to.** Your RSI session cookie (`Rsi-Token`, read so the background can call Spectrum's API on your behalf, exactly as the site does), Spectrum threads, channels, replies and your friends list, your hangar, buyback and store-credit pages, the public pledge-store catalog, and the public funding statistics. Used to track what you have read, mute and watch things, manage friend requests, list and value your pledges, plan CCU chains and paint buybacks, and notify you.
- **Account switcher (optional):** *Save this login* copies your RSI cookies into the extension's storage so you can switch between your own accounts. Nothing is saved unless you press it; *Forget* deletes it.
- **Public citizen pages (optional):** *Load all orgs* on the Friends tab reads your friends' public RSI profile pages to show their organisations.
- **StarOrg Tools (optional, off until you press Connect):** Settings → Integrations → StarOrg Tools. Optional: connect StarOrg Tools to send your ship list (hull, nickname, LTI / warbond / insurance, pledge id and pledge name; pledge values only if you turn that on). Off until you press Connect; nothing else ever leaves RSI.
  - *Connect* asks your browser for permission to reach `starorg.tools` (on Firefox also for the optional data-collection categories "personally identifying information" and "website content"), then opens StarOrg's own sign-in (Discord). RSI+ never sees your Discord or StarOrg password; it keeps the StarOrg sign-in token in the extension's local storage on this device (never in browser sync), for up to 90 days. If you cancel the sign-in or it fails, the permission is given back.
  - What a send contains: your RSI handle (the one logged in on RSI), and for each ship in your hangar and each in-game ship you entered on *My ships*: the hull name and code, maker, your nickname for it, LTI / warbond, the insurance term, the pledge id and pledge name, and whether it was pledged or bought in-game. Pledge values are sent only when *Send pledge values* is on (on Firefox, turning it on also asks for the "financial and payment information" category; refused, it stays off). Only a hangar read while the same RSI handle was logged in is sent. Nothing else from RSI (no store credit, buyback, orders, Spectrum, friends or cookies) is sent.
  - When it is sent: when you press *Send hangar now*, or, with *Auto-sync* on, after each full hangar load, and once a week, when RSI+ re-reads your hangar from RSI and sends it if your ship list changed since the last successful send (not in passive mode). Screenshare mode hides things on screen only; it does not change what is sent.
  - *Disconnect* signs the token out on StarOrg Tools, deletes it from the extension and removes the permission (on Firefox, the data-collection categories too). Chromium only: if an incognito window is also connected (it signs in separately), the shared permission stays until that one disconnects too. The ships already sent stay in your StarOrg Tools hangar until you remove them there, under StarOrg Tools' own privacy policy.

## Where data is stored

All data — settings, read marks, mutes, watches, friends snapshots, cached hangar / buyback / catalog pages, CCU chains, paint plans, saved logins — is stored in your browser's extension storage on your device (settings and the wishlist may sync through your browser's own account sync, if you have it on). Nothing is sent anywhere except to robertsspaceindustries.com, and only to do what you asked for — and, if you connect it, your ship list to StarOrg Tools as described above.

## What is not done

- No data is sold, shared, or transferred to third parties. The one exception is your own choice: the ship list you send to StarOrg Tools after connecting it.
- No tracking, analytics, or advertising.
- No remote code is loaded.
- Nothing is bought, melted, or sent on RSI without you clicking RSI's own button. *Add to cart* puts items in your RSI cart; checkout stays on RSI.

## Removal

Uninstalling the extension deletes all its stored data (saved logins and the StarOrg Tools token included). Logging out on RSI invalidates the session the extension used.

## Contact

Open an issue at <https://github.com/NyleGarcia/rsi-plus/issues>.
