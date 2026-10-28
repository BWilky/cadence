# Smoke test

A fake Home Assistant frontend (Lit from npm, a `home-assistant` element with canned states,
history and logbook) that loads the built card, exercises the chips, the button, the sheet
in phone and desktop layouts, the History page and the hash routes, then screenshots them.

```bash
cd test && npm install lit@3 playwright
npx http-server -p 8765 -s . &
node run.mjs          # screenshots land in test/shots/, console errors are listed at the end
```
