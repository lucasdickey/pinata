# Pinata capture (Chrome extension)

Captures the page you're on and sends it to Pinata, so you can pin feedback
on screens Pinata can't visit itself: anything behind a sign-in, on a staging
host, or running on your own machine (D131).

One click takes, for Desktop and Mobile:

- a full-page screenshot at Pinata's standard sizes (1440 and 390 CSS pixels
  wide, DPR 1), and
- the page's element list, made by the same in-page pass Pinata's own
  capture runs, so a pin, box, or arrow picks its nearest element the same
  way it does on any other capture.

Then either:

- **Send to Pinata**: uploads both to a project (an existing one, or a new
  one made from this page). Needs you signed in to Pinata from the extension.
- **Download file**: saves a `.pinata.json` capture file. Upload it from
  Pinata's overview ("Upload a capture"), under a capture ("Upload a new
  version"), or from New project ("Start from a capture file").

If sending fails, the capture is saved as a file anyway.

## Install

1. Open `chrome://extensions` and turn on **Developer mode**.
2. Click **Load unpacked** and choose this `extension/` folder.
3. Pin **Pinata capture** to the toolbar. `Alt+Shift+P` opens it too.

There is no build step: the files here are what Chrome loads. After pulling
changes, press the reload button on the extension's card.

## Sign in

Open the popup and sign in with the Pinata editor password. The extension
gets its own sign-in token (not your browser's Pinata cookie), keeps it in
the extension's storage, and stays signed in for 7 days; using it renews
that. **Sign out** forgets the token.

The Pinata address defaults to `https://yourpinata.dev`. To use another
deployment or a local one, change "Pinata address" before signing in;
`http://127.0.0.1:3100` (`npm run dev`) works out of the box, and any other
address asks Chrome for permission first.

## While it captures

Chrome shows a "Pinata capture started debugging this browser" bar: the
extension drives the tab through the Chrome DevTools Protocol, the same way
Pinata's own capture drives its browser. The tab flickers while it is laid
out at the Desktop and Mobile sizes; when it is done, the tab is put back as
it was (size, scroll position, animations). Pressing **Cancel** on the bar
stops the capture.

It never clicks, types, or navigates. What leaves the page is the
screenshot and the element list's bounded fields: element kind, tag, role, a
short visible text, an accessible name, a few safe hints (id, classes, alt,
title, test id), a structural path, and a rectangle. No form values, no
cookies or storage, no URLs from attributes.

## Limits

- Chrome doesn't let extensions capture `chrome://` pages or the Chrome Web
  Store.
- Mobile is the page re-laid out at 390 pixels with touch and a mobile user
  agent, not reloaded: a site that serves different markup to phones only on
  a fresh load shows its responsive layout here.
- A page taller than 16,384 pixels, or a screenshot that won't fit in 4 MB
  even compressed, can't be captured whole.

## Files

| File | What it does |
| --- | --- |
| `manifest.json` | Manifest V3: the popup, the service worker, permissions. |
| `popup.html`, `popup.js`, `popup.css` | Sign-in, the project and devices, Send / Download. |
| `background.js` | Runs a capture (it outlives the popup), sends it or saves it. |
| `capture.js` | The capture itself, through `chrome.debugger`. |
| `api.js`, `settings.js` | Pinata's extension routes; what the extension remembers. |
| `package.js` | The `.pinata.json` capture file. |
| `offscreen.html`, `offscreen.js` | Makes the blob URL a download needs. |
| `shared.generated.js` | **Generated** from the server: the element pass and limits. Rebuild with `npm run extension:build`. |
