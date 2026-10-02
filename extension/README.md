# Super Reader for Chrome

Saves the article in the current tab to Super Reader — its text as your
browser received it, subscriptions included — and, if you like, files it
into a subject, with any selected text as a quote and a note under it.

## Install (about a minute)

1. Open `chrome://extensions` and switch on **Developer mode** (top right).
2. Click **Load unpacked** and choose this `extension` folder.
3. Pin it: click the puzzle-piece icon in the toolbar, then the pin beside
   Super Reader.
4. Click it once and paste your sync code (Super Reader → **Sync across
   devices**).

## Use

On any article, click the icon. Pick a subject (or "Just save it"), add a
note if you want, and press **Save**. Select some text first to file it as a
quote. The story appears in Super Reader's **Saved** — and in the subject —
the next time you open or return to the app.

## How it works

The page is read in your browser with Mozilla's Readability
(`vendor/Readability.js`, Apache 2.0, see `vendor/Readability-LICENSE.md`)
and posted to `/api/inbox` under your sync code. The app files it on its
next sync and clears it from the inbox; anything not collected is dropped
after a week. Nothing is shared or cached publicly.

Updating Readability: `cp node_modules/@mozilla/readability/Readability.js extension/vendor/`.
