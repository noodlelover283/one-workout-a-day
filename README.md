# One Workout a Day

A phone-first gym tracker: log workouts, see progress, and find muscle groups that have plateaued.

## Run it

There is nothing to install or build. The app is plain HTML, CSS and JavaScript.

Open `index.html` in a browser, or serve the folder so it also works on your phone:

```powershell
# From this folder, in PowerShell, if Python is installed:
python -m http.server 8123
```

Then visit `http://localhost:8123`. Workouts are saved in your browser's local storage on that device.

## Run the tests

With the server above running, visit `http://localhost:8123/tests.html`. It lists every test as a pass or fail, and the tab title says `PASS` or `FAIL` with the count.

## Files

- `index.html`: the three screens (Log, History, Progress)
- `style.css`: phone-first styling
- `logic.js`: data rules (validation, plateau check, suggestions, sample data), no page access
- `tests.html` and `tests.js`: the tests (open `tests.html` through the server)

- `app.js`: connects the page to the data
- `i18n.js`: the translation helper (text lookup, plurals, dates)
- `lang-en.js` and `lang-xx.js`: the text for each language. English is the master list; every other language has the same keys. To add a language, copy `lang-en.js`, translate it, and add a `<script>` line in `index.html`
