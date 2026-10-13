# One Workout a Day

A phone-first gym tracker: log workouts, see progress, and find muscle groups that have plateaued.

## Run it

There is nothing to install or build. The app is plain HTML, CSS and JavaScript.

Open `index.html` in a browser, or serve the folder so it also works on your phone:

```powershell
# From this folder, in PowerShell, if Python is installed:
python serve.py
```

Then visit `http://localhost:8123`. Workouts are saved in your browser's local storage on that device.

## Run the tests

With the server above running, visit `http://localhost:8123/tests.html`. It lists every test as a pass or fail, and the tab title says `PASS` or `FAIL` with the count.

## Hosting

The app is live at https://noodlelover283.github.io/one-workout-a-day/ (GitHub Pages). The course repository is private, and Pages needs a public repository, so the site is served from a separate public copy, `noodlelover283/one-workout-a-day`, that holds only the app files.

To publish the latest version after changing the app, run this from the project folder (it needs Python, Git and being signed in to GitHub):

```powershell
python publish.py
```

It copies only the app files, so the private course files are never published. The site updates about a minute later.

## Files

- `index.html`: the three screens (Log, History, Progress)
- `style.css`: phone-first styling
- `logic.js`: data rules (validation, plateau check, suggestions, sample data), no page access
- `tests.html` and `tests.js`: the tests (open `tests.html` through the server)

- `serve.py`: the local test server (it stops your browser keeping old copies of the files)
- `publish.py`: copies the app files to the public hosting copy (see Hosting)
- `app.js`: connects the page to the data
- `i18n.js`: the translation helper (text lookup, plurals, dates)
- `lang-en.js` and `lang-xx.js`: the text for each language. English is the master list; every other language has the same keys. To add a language, copy `lang-en.js`, translate it, and add a `<script>` line in `index.html`
