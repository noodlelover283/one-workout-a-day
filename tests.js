// Tests for One Workout a Day. Serve the folder (python serve.py) and open /tests.html in a
// browser: every test is listed as a pass or fail, and the page title shows the total.

const results = [];
const unfinished = []; // tests that need to wait (the screen tests load the whole app)

// A test body may return a promise; its line is added now so the list keeps its order.
function test(name, body) {
  const result = { name, error: null };
  results.push(result);
  try {
    const outcome = body();
    if (outcome && typeof outcome.then === "function") unfinished.push(outcome.catch((error) => (result.error = error)));
  } catch (error) {
    result.error = error;
  }
}

function assertEqual(actual, expected, message = "") {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${message} expected ${e} but got ${a}`.trim());
}

const PLURAL_SUFFIX = /\.(zero|one|two|few|many|other)$/;
// Plural forms differ per language, so compare them as one entry ("reps") instead of one per form.
const baseKeys = (strings) => [...new Set(Object.keys(strings).map((key) => key.replace(PLURAL_SUFFIX, "")))];
const placeholders = (text) => (text.match(/\{\w+\}/g) || []).sort();

// ---------- Exercise demonstrations ----------

test("a built-in exercise links straight to its tutorial video", () => {
  assertEqual(Logic.demoUrl("Squat"), "https://www.youtube.com/watch?v=gcNh17Ckjgg");
});

test("every built-in exercise has a video", () => {
  for (const exercise of Object.keys(Logic.DEFAULT_EXERCISES)) {
    if (!Logic.demoUrl(exercise).includes("/watch?v=")) throw new Error(`${exercise} has no video`);
  }
});

test("a custom exercise links to a YouTube search for its name", () => {
  assertEqual(Logic.demoUrl("  Cable   Fly "), "https://www.youtube.com/results?search_query=Cable%20Fly%20proper%20form");
});

test("a custom exercise named like an object property still gets a search", () => {
  assertEqual(Logic.demoUrl("constructor").includes("/results?search_query="), true);
});

test("every built-in exercise has a form tip and a name in every language", () => {
  for (const [code, language] of Object.entries(registeredLanguages)) {
    for (const exercise of Object.keys(Logic.DEFAULT_EXERCISES)) {
      for (const key of [`tip.${exercise}`, `exercise.${exercise}`]) {
        if (!language.strings[key]) throw new Error(`${code} is missing "${key}"`);
      }
    }
  }
});

// ---------- Translations ----------

test("every language has exactly the same texts as English", () => {
  const english = baseKeys(registeredLanguages.en.strings);
  for (const [code, language] of Object.entries(registeredLanguages)) {
    const own = baseKeys(language.strings);
    const missing = english.filter((key) => !own.includes(key));
    const extra = own.filter((key) => !english.includes(key));
    if (missing.length || extra.length) throw new Error(`${code}: missing ${missing}, extra ${extra}`);
  }
});

test("every translation keeps the same {placeholders} as English", () => {
  const english = registeredLanguages.en.strings;
  for (const [code, language] of Object.entries(registeredLanguages)) {
    for (const [key, text] of Object.entries(language.strings)) {
      const source = english[key] !== undefined ? english[key] : english[key.replace(PLURAL_SUFFIX, ".other")];
      if (source === undefined) continue;
      // Some languages write "one rep" in words, so a singular form may leave out {count}.
      if (PLURAL_SUFFIX.test(key) && !key.endsWith(".other") && !text.includes("{count}")) continue;
      assertEqual(placeholders(text), placeholders(source), `${code} "${key}":`);
    }
  }
});

test("every language has a name, a locale and a text direction", () => {
  for (const [code, language] of Object.entries(registeredLanguages)) {
    if (!language.name || !language.locale || !["ltr", "rtl"].includes(language.dir)) throw new Error(code);
  }
});

// ---------- Weight suggestions ----------

const set = (date, weight, reps, exercise = "Bench Press") => ({ exercise, date, weight, reps });

test("suggests a heavier weight once every top set reaches the rep goal", () => {
  const entries = [set("2026-10-01", 135, 8), set("2026-10-01", 135, 9)];
  const suggestion = Logic.suggestNext(entries, "Bench Press", 8, 5);
  assertEqual([suggestion.weight, suggestion.reps, suggestion.increased], [140, 8, true]);
});

test("repeats the weight and aims for one more rep when the goal was missed", () => {
  const entries = [set("2026-10-01", 135, 8), set("2026-10-01", 135, 6)];
  const suggestion = Logic.suggestNext(entries, "Bench Press", 8, 5);
  assertEqual([suggestion.weight, suggestion.reps, suggestion.increased], [135, 7, false]);
});

test("only the heaviest weight decides the suggestion", () => {
  const entries = [set("2026-10-01", 115, 4), set("2026-10-01", 135, 8)];
  assertEqual(Logic.suggestNext(entries, "Bench Press", 8, 5).weight, 140);
});

test("no suggestion for an exercise that was never logged", () => {
  assertEqual(Logic.suggestNext([set("2026-10-01", 135, 8)], "Squat", 8, 10), null);
});

// ---------- Plateau check ----------

const muscleOf = (exercise) => Logic.DEFAULT_EXERCISES[exercise];

test("a muscle group with no new weight record for 21 days is stalled", () => {
  const entries = [set("2026-08-01", 100, 8), set("2026-08-10", 110, 8), set("2026-08-20", 110, 8), set("2026-09-05", 105, 8)];
  const [status] = Logic.plateauStatus(entries, muscleOf, "2026-09-20");
  assertEqual([status.group, status.state], ["Chest", "stalled"]);
});

test("a recent weight record means the group is progressing", () => {
  const entries = [set("2026-08-01", 100, 8), set("2026-08-10", 105, 8), set("2026-09-15", 110, 8)];
  assertEqual(Logic.plateauStatus(entries, muscleOf, "2026-09-20")[0].state, "progressing");
});

test("a group trained on fewer than three days is too new to judge", () => {
  const entries = [set("2026-08-01", 100, 8), set("2026-08-10", 100, 8)];
  assertEqual(Logic.plateauStatus(entries, muscleOf, "2026-10-20")[0].state, "new");
});

test("each muscle group can have its own stall time", () => {
  const entries = [set("2026-08-01", 100, 8), set("2026-08-10", 110, 8), set("2026-08-20", 110, 8)];
  const state = (days) => Logic.plateauStatus(entries, muscleOf, "2026-09-05", () => days)[0].state;
  assertEqual([state(14), state(30)], ["stalled", "progressing"]);
});

// ---------- Input checks ----------

test("rejects a blank exercise name, a negative weight and zero reps", () => {
  assertEqual(Logic.validateEntry({ exercise: "  ", weight: 100, reps: 5 }), "error.exerciseName");
  assertEqual(Logic.validateEntry({ exercise: "Squat", weight: -5, reps: 5 }), "error.weight");
  assertEqual(Logic.validateEntry({ exercise: "Squat", weight: 100, reps: 0 }), "error.reps");
  assertEqual(Logic.validateEntry({ exercise: "Squat", weight: 100, reps: 5 }), "");
});

test("accepts a bodyweight set of 0", () => {
  assertEqual(Logic.validateEntry({ exercise: "Pull-Up", weight: 0, reps: 8 }), "");
});

test("rest time must be between 5 and 3600 whole seconds", () => {
  const errors = [4, 5, 3600, 3601, 90.5].map(Logic.validateRestSeconds);
  assertEqual(errors, ["error.restSeconds", "", "", "error.restSeconds", "error.restSeconds"]);
});

test("a routine needs a name and at least one exercise", () => {
  assertEqual(Logic.validateRoutine({ name: "", exercises: ["Squat"] }) !== "", true);
  assertEqual(Logic.validateRoutine({ name: "Legs", exercises: [] }) !== "", true);
  assertEqual(Logic.validateRoutine({ name: "Legs", exercises: ["Squat"] }), "");
});

// ---------- Saved data and helpers ----------

test("old '3 sets of 8' entries are split into separate sets", () => {
  const migrated = Logic.migrateEntries([{ id: "a", exercise: "Squat", date: "2026-10-01", weight: 100, reps: 8, sets: 3 }]);
  assertEqual(migrated.map((entry) => entry.id), ["a-1", "a-2", "a-3"]);
  assertEqual(migrated.every((entry) => entry.sets === undefined), true);
});

test("exercise names match regardless of case and extra spaces", () => {
  assertEqual(Logic.findKnownExercise("  bench   PRESS ", {}), "Bench Press");
  assertEqual(Logic.findKnownExercise("Cable Fly", {}), null);
});

test("weights convert between pounds and kilograms", () => {
  assertEqual(Logic.formatWeight(Logic.toLb(60, "kg"), "kg"), "60");
  assertEqual(Logic.formatWeight(135, "lb"), "135");
});

test("the rest clock shows minutes and seconds", () => {
  assertEqual([90, 5, 0, -3, 59.2].map(Logic.formatClock), ["1:30", "0:05", "0:00", "0:00", "1:00"]);
});

test("bad saved display settings fall back to the defaults", () => {
  assertEqual(Logic.sanitizeAppearance({ theme: "neon", textSize: 999 }), Logic.DEFAULT_APPEARANCE);
  assertEqual(Logic.sanitizeAppearance({ theme: "dark", textSize: 150 }), { theme: "dark", textSize: 150 });
});

// ---------- Editing and deleting custom exercises ----------

const customData = () => ({
  entries: [
    { id: "1", ...set("2026-10-01", 30, 10, "Cabel Fly") },
    { id: "2", ...set("2026-10-02", 135, 8, "Bench Press") },
    { id: "3", ...set("2026-10-03", 35, 10, "Cabel Fly") },
  ],
  routines: [
    { id: "r1", name: "Push", exercises: ["Bench Press", "Cabel Fly"] },
    { id: "r2", name: "Legs", exercises: ["Squat"] },
  ],
  customExercises: { "Cabel Fly": "Chest" },
});

test("renaming a custom exercise updates its sets, routines and group, and leaves everything else alone", () => {
  const result = Logic.renameExercise(customData(), "Cabel Fly", "Cable Fly", "Arms");
  assertEqual(result.entries.map((e) => e.exercise), ["Cable Fly", "Bench Press", "Cable Fly"]);
  assertEqual(result.routines.map((r) => r.exercises), [["Bench Press", "Cable Fly"], ["Squat"]]);
  assertEqual(result.customExercises, { "Cable Fly": "Arms" });
  assertEqual([result.newName, result.merging], ["Cable Fly", false]);
});

test("only changing the muscle group keeps the name and every set", () => {
  const result = Logic.renameExercise(customData(), "Cabel Fly", "Cabel Fly", "Shoulders");
  assertEqual(result.customExercises, { "Cabel Fly": "Shoulders" });
  assertEqual(result.entries.length, 3);
});

test("changing only the capital letters is a rename, not a merge", () => {
  const result = Logic.renameExercise(customData(), "Cabel Fly", "cabel fly", "Chest");
  assertEqual([result.merging, result.newName], [false, "cabel fly"]);
});

test("renaming into an existing exercise merges them and keeps that exercise's group", () => {
  const data = { ...customData(), customExercises: { "Cabel Fly": "Chest", "Chest Fly": "Arms" } };
  const result = Logic.renameExercise(data, "Cabel Fly", "chest fly", "Back");
  assertEqual([result.merging, result.newName, result.customExercises], [true, "Chest Fly", { "Chest Fly": "Arms" }]);
  assertEqual(result.entries.map((e) => e.exercise), ["Chest Fly", "Bench Press", "Chest Fly"]);
});

test("merging a typo into a built-in exercise moves its sets there, once per routine", () => {
  const data = customData();
  data.entries[0].exercise = "Bench Pres";
  data.customExercises = { "Bench Pres": "Arms" };
  data.routines = [{ id: "r1", name: "Push", exercises: ["Bench Press", "Bench Pres"] }];
  const result = Logic.renameExercise(data, "Bench Pres", "Bench Press", "Arms");
  assertEqual([result.merging, result.customExercises, result.entries[0].exercise], [true, {}, "Bench Press"]);
  assertEqual(result.routines[0].exercises, ["Bench Press"]);
});

test("deleting a custom exercise removes its sets and its place in routines only", () => {
  const result = Logic.deleteExercise(customData(), "Cabel Fly");
  assertEqual(result.entries.map((e) => e.exercise), ["Bench Press"]);
  assertEqual(result.routines.map((r) => r.exercises), [["Bench Press"], ["Squat"]]);
  assertEqual(result.customExercises, {});
});

test("usage counts the sets and routines an exercise appears in", () => {
  assertEqual(Logic.exerciseUsage(customData(), "Cabel Fly"), { sets: 2, routines: 1 });
  assertEqual(Logic.exerciseUsage(customData(), "Deadlift"), { sets: 0, routines: 0 });
});

// ---------- Routine targets ----------

test("typed targets become numbers, and boxes left empty mean no target", () => {
  const typed = { "Bench Press": { sets: "3", reps: " 8 " }, "Squat": { sets: "", reps: "" }, "Row": undefined };
  assertEqual(Logic.parseTargets(["Bench Press", "Squat", "Row"], typed), { targets: { "Bench Press": { sets: 3, reps: 8 } } });
});

test("a target needs both whole numbers in range, or neither", () => {
  const bad = [{ sets: "3", reps: "" }, { sets: "", reps: "8" }, { sets: "0", reps: "8" }, { sets: "21", reps: "8" }, { sets: "3", reps: "101" }, { sets: "2.5", reps: "8" }, { sets: "-3", reps: "8" }, { sets: "three", reps: "8" }];
  for (const typed of bad) assertEqual(Logic.parseTargets(["Squat"], { Squat: typed }), { error: "error.target" }, JSON.stringify(typed));
  assertEqual(Logic.parseTargets(["Squat"], { Squat: { sets: "20", reps: "100" } }).error, undefined);
});

test("an exercise listed twice in a routine gets one target", () => {
  assertEqual(Logic.parseTargets(["Squat", "Squat"], { Squat: { sets: "3", reps: "5" } }), { targets: { Squat: { sets: 3, reps: 5 } } });
});

test("saved targets that are damaged or for exercises no longer in the routine are dropped", () => {
  const saved = { "Bench Press": { sets: 3, reps: 8 }, "Squat": { sets: 0, reps: 5 }, "Row": { sets: 3, reps: 8 }, "Curl": "x" };
  assertEqual(Logic.sanitizeTargets(saved, ["Bench Press", "Squat", "Curl"]), { "Bench Press": { sets: 3, reps: 8 } });
  assertEqual([Logic.sanitizeTargets(undefined, ["Squat"]), Logic.sanitizeTargets("text", ["Squat"]), Logic.sanitizeTargets(saved, undefined)], [{}, {}, {}]);
});

test("progress counts today's sets of an exercise against its target", () => {
  const today = [set("2026-10-13", 135, 8), set("2026-10-13", 135, 8), set("2026-10-13", 100, 5, "Squat")];
  assertEqual(Logic.routineProgress(today, "Bench Press", { sets: 3, reps: 8 }), { logged: 2, goal: 3, done: false });
  assertEqual(Logic.routineProgress([...today, set("2026-10-13", 135, 7)], "Bench Press", { sets: 3, reps: 8 }).done, true);
});

test("without a target, one logged set is enough to count an exercise as done", () => {
  assertEqual(Logic.routineProgress([set("2026-10-13", 100, 5, "Squat")], "Squat", undefined), { logged: 1, goal: null, done: true });
  assertEqual(Logic.routineProgress([], "Squat", undefined), { logged: 0, goal: null, done: false });
});

test("renaming or deleting an exercise carries its routine target along", () => {
  const data = {
    entries: [],
    routines: [{ id: "r", name: "Push", exercises: ["Cabel Fly", "Bench Press"], targets: { "Cabel Fly": { sets: 3, reps: 12 }, "Bench Press": { sets: 4, reps: 6 } } }],
    customExercises: { "Cabel Fly": "Chest" },
  };
  const renamed = Logic.renameExercise(data, "Cabel Fly", "Cable Fly", "Chest");
  assertEqual(renamed.routines[0].targets, { "Bench Press": { sets: 4, reps: 6 }, "Cable Fly": { sets: 3, reps: 12 } });
  const merged = Logic.renameExercise(data, "Cabel Fly", "Bench Press", "Chest");
  assertEqual(merged.routines[0].targets, { "Bench Press": { sets: 4, reps: 6 } }, "the existing exercise keeps its own target:");
  assertEqual(Logic.deleteExercise(data, "Cabel Fly").routines[0].targets, { "Bench Press": { sets: 4, reps: 6 } });
});

// ---------- Strength levels ----------

test("every lift has five rising level thresholds, and women's are lower than men's", () => {
  for (const lift of Logic.STRENGTH_LIFTS) {
    for (const sex of Logic.STRENGTH_SEXES) {
      const thresholds = Logic.STRENGTH_STANDARDS[sex][lift];
      assertEqual(thresholds.length, Logic.STRENGTH_LEVELS.length, `${sex} ${lift}:`);
      if (!thresholds.every((value, i) => i === 0 || value > thresholds[i - 1])) throw new Error(`${sex} ${lift} does not rise`);
    }
    Logic.STRENGTH_STANDARDS.male[lift].forEach((value, i) => {
      if (Logic.STRENGTH_STANDARDS.female[lift][i] >= value) throw new Error(`female ${lift} level ${i} is not lower`);
    });
  }
});

test("a lift is placed at the highest level whose ratio it reaches, with the next target", () => {
  // Male bench: Intermediate needs 1.1x, Advanced 1.35x. An 80 lb bodyweight and an 88 lb max is 1.1x.
  const result = Logic.strengthLevel("male", "Bench Press", 88, 80);
  assertEqual([result.level, result.next.level, Math.round(result.next.weight)], ["Intermediate", "Advanced", 108]);
});

test("below the first level, at exactly a level, and at the top", () => {
  assertEqual(Logic.strengthLevel("male", "Squat", 30, 100).level, null);
  assertEqual(Logic.strengthLevel("male", "Squat", 30, 100).next.level, "Beginner");
  assertEqual(Logic.strengthLevel("female", "Deadlift", 130, 100).level, "Intermediate");
  const top = Logic.strengthLevel("male", "Deadlift", 300, 100);
  assertEqual([top.level, top.next], ["Elite", null]);
});

test("no comparison without a sex, a known lift or a bodyweight", () => {
  assertEqual(Logic.strengthLevel("", "Squat", 200, 80), null);
  assertEqual(Logic.strengthLevel("male", "Bicep Curl", 50, 80), null);
  assertEqual(Logic.strengthLevel("male", "Squat", 200, 0), null);
});

test("the latest bodyweight is the one with the newest date", () => {
  assertEqual(Logic.latestBodyweight([{ date: "2026-10-05", weight: 170 }, { date: "2026-10-09", weight: 168 }, { date: "2026-09-01", weight: 175 }]), 168);
  assertEqual(Logic.latestBodyweight([]), null);
});

// ---------- Body measurements ----------

test("lengths convert between inches and centimetres with the weight toggle", () => {
  assertEqual([Logic.lengthUnitFor("lb"), Logic.lengthUnitFor("kg")], ["in", "cm"]);
  assertEqual(Logic.formatLength(Logic.lengthToCm(32, "lb"), "lb"), "32");
  assertEqual(Logic.formatLength(81.28, "lb"), "32");
  assertEqual([Logic.formatLength(81.28, "kg"), Logic.lengthToCm(81.28, "kg")], ["81.3", 81.28]);
});

test("a measurement must be above 0 and at most 300 cm", () => {
  assertEqual([0, -4, NaN, 80, 300, 301].map(Logic.validateMeasurement), ["error.measurement", "error.measurement", "error.measurement", "", "", "error.measurement"]);
});

test("adding a measurement again on the same day replaces it, other names and days are kept", () => {
  const first = Logic.setMeasurement([], { date: "2026-10-01", name: "Waist", cm: 82 });
  const more = Logic.setMeasurement(first, { date: "2026-10-01", name: "Chest", cm: 100 });
  const again = Logic.setMeasurement(more, { date: "2026-10-01", name: "Waist", cm: 81 });
  assertEqual(again.map((m) => [m.name, m.cm]).sort(), [["Chest", 100], ["Waist", 81]]);
  assertEqual(first.length, 1, "the original list must not change:");
});

test("a measurement series has one name only, oldest first", () => {
  const list = [
    { date: "2026-10-05", name: "Waist", cm: 80 },
    { date: "2026-10-01", name: "Waist", cm: 82 },
    { date: "2026-10-03", name: "Chest", cm: 100 },
  ];
  assertEqual(Logic.measurementSeries(list, "Waist"), [{ date: "2026-10-01", value: 82 }, { date: "2026-10-05", value: 80 }]);
});

test("bad saved measurements are dropped", () => {
  const good = { date: "2026-10-01", name: "Waist", cm: 82 };
  const saved = [good, { date: "2026-10-01", name: "Elbow", cm: 30 }, { date: "bad", name: "Waist", cm: 82 }, { date: "2026-10-02", name: "Waist", cm: "82" }, null];
  assertEqual(Logic.sanitizeMeasurements(saved), [good]);
  assertEqual(Logic.sanitizeMeasurements(undefined), []);
});

// ---------- Calendar ----------

test("a month is laid out in whole weeks with the right first weekday", () => {
  // 1 October 2026 is a Thursday.
  const sundayFirst = Logic.monthCells(2026, 9, 0);
  const mondayFirst = Logic.monthCells(2026, 9, 1);
  assertEqual([sundayFirst.length, sundayFirst.indexOf("2026-10-01"), sundayFirst.filter(Boolean).length], [35, 4, 31]);
  assertEqual([mondayFirst.length, mondayFirst.indexOf("2026-10-01")], [35, 3]);
});

test("a month that needs six rows gets six rows, and February has 28 or 29 days", () => {
  assertEqual(Logic.monthCells(2026, 7, 0).length, 42); // August 2026 starts on a Saturday
  assertEqual([Logic.monthCells(2026, 1, 0).filter(Boolean).length, Logic.monthCells(2028, 1, 0).filter(Boolean).length], [28, 29]);
});

test("a week starts on the chosen weekday, whatever date in it is asked", () => {
  // 13 October 2026 is a Tuesday.
  assertEqual([Logic.weekStartOf("2026-10-13", 1), Logic.weekStartOf("2026-10-13", 0), Logic.weekStartOf("2026-10-12", 1)], ["2026-10-12", "2026-10-11", "2026-10-12"]);
  assertEqual([Logic.weekStartOf("2026-10-11", 1), Logic.weekStartOf("2027-01-02", 1)], ["2026-10-05", "2026-12-28"]);
});

test("a weekly streak counts the weeks in a row with a workout, back from this week", () => {
  const days = new Set(["2026-10-12", "2026-10-06", "2026-09-30", "2026-09-14"]);
  assertEqual(Logic.currentWeeklyStreak(days, "2026-10-13", 1), 3);
});

test("a weekly streak is not broken just because this week has no workout yet", () => {
  assertEqual(Logic.currentWeeklyStreak(new Set(["2026-10-06", "2026-09-30"]), "2026-10-13", 1), 2);
});

test("a whole week without a workout ends the streak", () => {
  assertEqual(Logic.currentWeeklyStreak(new Set(["2026-09-30"]), "2026-10-13", 1), 0);
  assertEqual(Logic.currentWeeklyStreak(new Set(), "2026-10-13", 1), 0);
});

test("several workouts in one week count as one week", () => {
  assertEqual(Logic.currentWeeklyStreak(new Set(["2026-10-12", "2026-10-13", "2026-10-14"]), "2026-10-14", 1), 1);
});

test("where the week starts can change the streak, and a streak crosses the new year", () => {
  // Saturday 10 and Sunday 11 October are one week when weeks start on Monday, two when they start on Sunday.
  const weekend = new Set(["2026-10-10", "2026-10-11"]);
  assertEqual([Logic.currentWeeklyStreak(weekend, "2026-10-11", 1), Logic.currentWeeklyStreak(weekend, "2026-10-11", 0)], [1, 2]);
  assertEqual(Logic.currentWeeklyStreak(new Set(["2026-12-30", "2027-01-05"]), "2027-01-06", 1), 2);
});

// ---------- Workout notes ----------

test("a note is saved for its day, trimmed, and an empty note removes it", () => {
  const notes = Logic.setNote({}, "2026-10-11", "  Slept badly  ");
  assertEqual(notes, { "2026-10-11": "Slept badly" });
  assertEqual(Logic.setNote(notes, "2026-10-12", "Felt strong"), { "2026-10-11": "Slept badly", "2026-10-12": "Felt strong" });
  assertEqual(Logic.setNote(notes, "2026-10-11", "   "), {});
  assertEqual(notes, { "2026-10-11": "Slept badly" }, "the original notes must not change:");
});

test("a very long note is cut to the limit", () => {
  const note = Logic.setNote({}, "2026-10-11", "x".repeat(Logic.NOTE_MAX_LENGTH + 500))["2026-10-11"];
  assertEqual(note.length, Logic.NOTE_MAX_LENGTH);
});

test("bad saved notes are dropped and good ones kept", () => {
  assertEqual(Logic.sanitizeNotes({ "2026-10-11": " ok ", yesterday: "bad date", "2026-10-12": 5, "2026-10-13": "  " }), { "2026-10-11": "ok" });
  assertEqual([Logic.sanitizeNotes(undefined), Logic.sanitizeNotes("text"), Logic.sanitizeNotes(null)], [{}, {}, {}]);
});

// ---------- Estimated one-rep max ----------

test("the one-rep max estimate follows the Epley formula", () => {
  assertEqual(Logic.estimateOneRepMax(200, 1), 200);
  assertEqual(Logic.estimateOneRepMax(150, 6), 180);
  assertEqual(Math.round(Logic.estimateOneRepMax(145, 8) * 10) / 10, 183.7);
});

test("the best estimate comes from whichever set gives the highest number, not the heaviest", () => {
  const entries = [set("2026-10-01", 145, 3), set("2026-10-05", 130, 12), set("2026-10-06", 100, 5, "Squat")];
  const best = Logic.bestOneRepMax(entries, "Bench Press");
  assertEqual([best.weight, best.reps, best.date], [130, 12, "2026-10-05"]);
});

test("sets over 12 reps and sets with no weight give no estimate", () => {
  const entries = [set("2026-10-01", 100, 20), set("2026-10-02", 0, 10, "Pull-Up")];
  assertEqual([Logic.bestOneRepMax(entries, "Bench Press"), Logic.bestOneRepMax(entries, "Pull-Up")], [null, null]);
  assertEqual(Logic.oneRepMaxSeries(entries, "Bench Press"), []);
});

test("the estimate series has the best estimate for each day, oldest first", () => {
  const entries = [set("2026-10-02", 150, 6), set("2026-10-01", 100, 1), set("2026-10-02", 140, 2)];
  assertEqual(Logic.oneRepMaxSeries(entries, "Bench Press"), [
    { date: "2026-10-01", value: 100 },
    { date: "2026-10-02", value: 180 },
  ]);
});

// ---------- New records ----------

test("the best weight is the heaviest set of that exercise only", () => {
  const entries = [set("2026-10-01", 135, 8), set("2026-10-02", 145, 3), set("2026-10-02", 300, 5, "Squat")];
  assertEqual([Logic.bestWeight(entries, "Bench Press"), Logic.bestWeight(entries, "Squat"), Logic.bestWeight(entries, "Deadlift")], [145, 300, null]);
});

test("a set heavier than the best is a record; matching it or the first ever set is not", () => {
  assertEqual([Logic.isNewRecord(145, 150), Logic.isNewRecord(145, 145), Logic.isNewRecord(145, 100), Logic.isNewRecord(null, 100)], [true, false, false, false]);
});

// ---------- Editing a set ----------

const editData = () => ({
  entries: [
    { id: "a", ...set("2026-10-01", 135, 8) },
    { id: "b", ...set("2026-10-01", 30, 10, "Cabel Fly") },
    { id: "c", ...set("2026-10-02", 35, 10, "Cabel Fly") },
  ],
  routines: [],
  customExercises: { "Cabel Fly": "Chest" },
});

test("editing a set changes only that set's weight and reps", () => {
  const data = editData();
  const result = Logic.updateSetDetails(data, "a", { exercise: "Bench Press", weight: 140, reps: 6 }, "Chest");
  assertEqual(result.entries.map((e) => [e.id, e.exercise, e.weight, e.reps]), [["a", "Bench Press", 140, 6], ["b", "Cabel Fly", 30, 10], ["c", "Cabel Fly", 35, 10]]);
  assertEqual([result.moved, result.customExercises], [false, { "Cabel Fly": "Chest" }]);
  assertEqual(data.entries[0].weight, 135, "the original list must not change:");
});

test("changing a set's name to a known exercise moves just that set, whatever the letter case", () => {
  const result = Logic.updateSetDetails(editData(), "b", { exercise: "  bench PRESS ", weight: 100, reps: 5 }, "Arms");
  assertEqual(result.entries.map((e) => e.exercise), ["Bench Press", "Bench Press", "Cabel Fly"]);
  assertEqual([result.moved, result.exercise], [true, "Bench Press"]);
  assertEqual(result.customExercises, { "Cabel Fly": "Chest" }, "the typo still has a set, so it stays:");
});

test("moving the last set of a typo'd exercise away drops that exercise, unless a routine uses it", () => {
  const data = editData();
  data.entries = data.entries.filter((e) => e.id !== "c");
  const dropped = Logic.updateSetDetails(data, "b", { exercise: "Bench Press", weight: 100, reps: 5 }, "Chest");
  assertEqual(dropped.customExercises, {});
  data.routines = [{ id: "r", name: "Push", exercises: ["Cabel Fly"] }];
  const kept = Logic.updateSetDetails(data, "b", { exercise: "Bench Press", weight: 100, reps: 5 }, "Chest");
  assertEqual(kept.customExercises, { "Cabel Fly": "Chest" });
});

test("changing a set to a name nobody knows creates a custom exercise in the chosen group", () => {
  const result = Logic.updateSetDetails(editData(), "a", { exercise: "Cable Fly", weight: 20, reps: 12 }, "Arms");
  assertEqual([result.entries[0].exercise, result.moved], ["Cable Fly", true]);
  assertEqual(result.customExercises, { "Cabel Fly": "Chest", "Cable Fly": "Arms" });
});

// ---------- Backup and restore ----------

const sampleSaved = { entries: [set("2026-10-01", 135, 8)], bodyweights: [{ date: "2026-10-01", weight: 170 }], unit: "kg" };

test("a backup file reads back to exactly the data that was saved", () => {
  const text = JSON.stringify(Logic.makeBackup(sampleSaved, "2026-10-02T09:00:00.000Z"));
  assertEqual(Logic.parseBackup(text), { data: sampleSaved, exportedAt: "2026-10-02T09:00:00.000Z" });
});

test("a backup of an empty app can be restored", () => {
  const text = JSON.stringify(Logic.makeBackup({ entries: [], bodyweights: [] }, "2026-10-02T09:00:00.000Z"));
  assertEqual(Logic.parseBackup(text).error, undefined);
});

test("files that are not a backup from this app are refused", () => {
  const refused = [
    "not json at all",
    "null",
    JSON.stringify({ entries: [], bodyweights: [] }), // raw data without the backup label
    JSON.stringify({ app: "some-other-app", version: 1, data: { entries: [], bodyweights: [] } }),
    JSON.stringify({ app: "one-workout-a-day", version: 1, data: { entries: "oops", bodyweights: [] } }),
  ];
  assertEqual(refused.map((text) => Logic.parseBackup(text).error), Array(refused.length).fill("error.backupFile"));
});

test("a backup with a damaged workout is refused instead of half-restored", () => {
  const bad = { ...sampleSaved, entries: [set("2026-10-01", 135, 8), { exercise: "Squat", date: "yesterday", weight: "heavy", reps: 5 }] };
  assertEqual(Logic.parseBackup(JSON.stringify(Logic.makeBackup(bad, "2026-10-02"))).error, "error.backupFile");
});

test("a backup from a newer version of the app is refused with its own message", () => {
  const text = JSON.stringify({ ...Logic.makeBackup(sampleSaved, "2026-10-02"), version: 99 });
  assertEqual(Logic.parseBackup(text).error, "error.backupNewer");
});

// ---------- Home screen ----------

// Reads a PNG file's header: is it really a PNG, and how many pixels wide and tall?
async function pngInfo(url) {
  const bytes = new DataView(await (await fetch(url, { cache: "no-store" })).arrayBuffer());
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  return { isPng: signature.every((value, index) => bytes.getUint8(index) === value), width: bytes.getUint32(16), height: bytes.getUint32(20) };
}

test("the app description names the app and its icons are real pictures of the size it promises", async () => {
  const manifest = await (await fetch("manifest.webmanifest", { cache: "no-store" })).json();
  assertEqual([manifest.name, manifest.short_name, manifest.display, manifest.start_url], ["One Workout a Day", "One Workout", "standalone", "./"]);
  for (const icon of manifest.icons) {
    const [width, height] = icon.sizes.split("x").map(Number);
    const info = await pngInfo(icon.src);
    assertEqual([info.isPng, info.width, info.height], [true, width, height], icon.src);
  }
  const sizes = manifest.icons.map((icon) => `${icon.sizes} ${icon.purpose}`);
  for (const wanted of ["192x192 any", "512x512 any", "512x512 maskable"]) {
    if (!sizes.includes(wanted)) throw new Error(`no ${wanted} icon`);
  }
});

test("the page links its app description and a 180 pixel iPhone icon, and opens full screen when added", async () => {
  const page = await (await fetch("index.html", { cache: "no-store" })).text();
  for (const needed of ['rel="manifest" href="manifest.webmanifest"', 'rel="apple-touch-icon" href="apple-touch-icon.png"', 'name="apple-mobile-web-app-capable" content="yes"', 'name="apple-mobile-web-app-title"', 'name="theme-color"']) {
    if (!page.includes(needed)) throw new Error(`index.html is missing ${needed}`);
  }
  const icon = await pngInfo("apple-touch-icon.png");
  assertEqual([icon.isPng, icon.width, icon.height], [true, 180, 180]);
});

// ---------- Offline use ----------

test("sw.js saves every file the page loads, so the app can start with no connection", async () => {
  const page = await (await fetch("index.html", { cache: "no-store" })).text();
  const loaded = [...page.matchAll(/(?:src|href)="([\w.-]+\.(?:js|css))"/g)].map((match) => match[1]);
  const worker = await (await fetch("sw.js", { cache: "no-store" })).text();
  const missing = loaded.filter((file) => !worker.includes(`"${file}"`));
  if (loaded.length < 10) throw new Error(`expected to find the page's files, found ${loaded.length}`);
  if (missing.length) throw new Error(`sw.js does not list: ${missing.join(", ")}`);
  if (!worker.includes('"index.html"')) throw new Error("sw.js does not list index.html");
});

// These run sw.js itself against a pretend network and a pretend cache, because a test page cannot
// switch a real connection off. The pretend site is `files` (path -> text); change it to "update" the
// site, and set `online.on = false` to take the connection away.
async function startWorker() {
  const source = await (await fetch("sw.js", { cache: "no-store" })).text();
  const listed = [...source.match(/APP_FILES = \[([\s\S]*?)\]/)[1].matchAll(/"([^"]+)"/g)].map((match) => match[1]);
  const files = {};
  for (const name of listed) files[name === "./" ? "/app/" : `/app/${name}`] = `${name} v1`;
  const online = { on: true };
  const saved = new Map();
  const handlers = {};
  const fakeCaches = {
    open: async () => ({
      put: async (key, response) => saved.set(key, response.clone()),
      match: async (key) => (saved.has(key) ? saved.get(key).clone() : undefined),
    }),
    keys: async () => [],
    delete: async () => true,
  };
  const fakeSelf = {
    location: new URL("https://example.test/app/sw.js"),
    addEventListener: (type, handler) => (handlers[type] = handler),
    skipWaiting: () => {},
    clients: { claim: async () => {} },
  };
  const fakeFetch = async (request) => {
    if (!online.on) throw new TypeError("Failed to fetch");
    const path = new URL(request.url || String(request)).pathname;
    return path in files ? new Response(files[path]) : new Response("missing", { status: 404 });
  };
  new Function("self", "caches", "fetch", source)(fakeSelf, fakeCaches, fakeFetch);

  let installing;
  handlers.install({ waitUntil: (work) => (installing = work) });
  await installing;
  return {
    files,
    online,
    listed,
    saved,
    // The worker's answer text for a request, or null if it leaves the request to the browser.
    async ask(url, { method = "GET", mode = "no-cors" } = {}) {
      let answer = null;
      handlers.fetch({ request: { url, method, mode }, respondWith: (work) => (answer = work) });
      return answer === null ? null : (await answer).text();
    },
  };
}

test("installing saves a copy of every file in the worker's list", async () => {
  const worker = await startWorker();
  assertEqual(worker.saved.size, worker.listed.length);
  assertEqual(worker.listed.length > 10, true);
});

test("online the worker serves the newest file and refreshes its copy; offline it serves that copy", async () => {
  const worker = await startWorker();
  assertEqual(await worker.ask("https://example.test/app/app.js?v=111"), "app.js v1");
  worker.files["/app/app.js"] = "app.js v2"; // the site is updated while the phone is online
  assertEqual(await worker.ask("https://example.test/app/app.js?v=222"), "app.js v2");
  worker.online.on = false;
  assertEqual(await worker.ask("https://example.test/app/app.js?v=222"), "app.js v2", "offline, same address:");
  assertEqual(await worker.ask("https://example.test/app/app.js?v=999"), "app.js v2", "offline, a different ?v= code:");
  assertEqual(await worker.ask("https://example.test/app/app.js"), "app.js v2", "offline, no ?v= code:");
});

test("offline, opening the app falls back to the saved home page, but an unsaved file is an error", async () => {
  const worker = await startWorker();
  worker.online.on = false;
  assertEqual(await worker.ask("https://example.test/app/", { mode: "navigate" }), "./ v1");
  assertEqual(await worker.ask("https://example.test/app/whatever", { mode: "navigate" }), "./ v1");
  let failed = false;
  try {
    await worker.ask("https://example.test/app/never-saved.js");
  } catch (error) {
    failed = true;
  }
  assertEqual(failed, true, "an unsaved file should fail, not be invented:");
});

test("the worker leaves other websites and non-GET requests to the browser", async () => {
  const worker = await startWorker();
  assertEqual(await worker.ask("https://www.youtube.com/watch?v=abc"), null);
  assertEqual(await worker.ask("https://example.test/app/app.js", { method: "POST" }), null);
});

// ---------- Screens ----------
// These open the real app in a hidden frame and click through it. The app is given its own storage
// name (see STORAGE_KEY in app.js), so the tests never touch real workouts.

let screenRuns = 0; // each screen test gets its own storage name, so tests running together cannot clash
const TAB_NAMES = ["log", "routines", "history", "progress"];

// Throwaway data with something on every screen: sets, bodyweights, a routine with targets, a note,
// two waist measurements, and a comparison group chosen.
function screenTestData() {
  const todayString = Logic.toDateString(new Date());
  const sample = Logic.sampleData(todayString);
  return {
    entries: sample.entries,
    bodyweights: sample.bodyweights,
    routines: [{ id: "r1", name: "Push", exercises: ["Bench Press", "Overhead Press"], targets: { "Bench Press": { sets: 3, reps: 8 } } }],
    notes: { [todayString]: "Felt strong" },
    measurements: [
      { date: "2026-09-01", name: "Waist", cm: 82 },
      { date: "2026-10-01", name: "Waist", cm: 80 },
    ],
    sex: "male",
    language: "en",
  };
}

// Loads the app in a hidden frame on throwaway data. Resolves with the frame, its document, and a list
// that fills with any errors the app raises afterwards.
function openApp() {
  const storage = `screen-test-${(screenRuns += 1)}`;
  localStorage.setItem(storage, JSON.stringify(screenTestData()));
  return new Promise((resolve) => {
    const frame = document.createElement("iframe");
    frame.style.cssText = "position: absolute; left: -9999px; width: 375px; height: 812px; border: 0;";
    frame.src = `index.html?storage=${storage}`;
    frame.addEventListener("load", () => {
      const errors = [];
      frame.contentWindow.addEventListener("error", (event) => errors.push(event.message));
      frame.contentWindow.addEventListener("unhandledrejection", (event) => errors.push(String(event.reason)));
      resolve({ frame, storage, doc: frame.contentDocument, win: frame.contentWindow, errors });
    });
    document.body.append(frame);
  });
}

function closeApp(app) {
  app.frame.remove();
  localStorage.removeItem(app.storage);
}

function showTab(app, name) {
  app.doc.getElementById(`nav-${name}`).click();
  return app.doc.getElementById(`tab-${name}`);
}

test("every tab draws its screen, with no errors", async () => {
  const app = await openApp();
  try {
    const expected = {
      log: ["#log-form", "#today-list", "#routine-select", "#workout-note"],
      routines: ["#routine-list .routine-card", "#routine-form", "#my-exercises"],
      history: ["#calendar-grid .day-cell", "#history .day", "#backup-download"],
      progress: ["#plateau-cards", "#exercise-chart svg", "#strength-results .strength-card", "#bodyweight-chart svg", "#measure-chart svg"],
    };
    for (const name of TAB_NAMES) {
      const tab = showTab(app, name);
      if (tab.classList.contains("hidden")) throw new Error(`the ${name} tab did not open`);
      if (tab.innerText.trim().length < 50) throw new Error(`the ${name} tab is almost empty`);
      if (name === "progress") {
        // The measurement chart shows one body part at a time; the test data has a waist.
        const picker = app.doc.getElementById("measure-name");
        picker.value = "Waist";
        picker.dispatchEvent(new Event("change", { bubbles: true }));
      }
      for (const selector of expected[name]) {
        if (!tab.querySelector(selector)) throw new Error(`the ${name} tab is missing ${selector}`);
      }
    }
    if (app.errors.length) throw new Error(`the app raised errors: ${app.errors.join("; ")}`);
  } finally {
    closeApp(app);
  }
});

test("no text key shows through on any tab in any language", async () => {
  const app = await openApp();
  try {
    // Every key any language defines, so a key missing from one language is still recognised if it shows.
    const keys = [...new Set(Object.values(registeredLanguages).flatMap((language) => Object.keys(language.strings)))];
    const select = app.doc.getElementById("language-select");
    // Open a routine for editing, so its target boxes and their labels are on screen too.
    showTab(app, "routines");
    app.doc.querySelector("#routine-list .routine-card button.link").click();
    for (const code of Object.keys(registeredLanguages)) {
      select.value = code;
      select.dispatchEvent(new Event("change", { bubbles: true }));
      for (const name of TAB_NAMES) {
        const tab = showTab(app, name);
        const attributes = [...tab.querySelectorAll("[aria-label], [placeholder], [title]")].map(
          (node) => `${node.getAttribute("aria-label")} ${node.getAttribute("placeholder")} ${node.title}`,
        );
        const shown = `${tab.innerText} ${app.doc.querySelector("header").innerText} ${attributes.join(" ")}`;
        const raw = keys.filter((key) => shown.includes(key));
        if (raw.length) throw new Error(`${code}, ${name} tab: shows the key ${raw.slice(0, 3).join(", ")}`);
      }
    }
    if (app.errors.length) throw new Error(`the app raised errors: ${app.errors.join("; ")}`);
  } finally {
    closeApp(app);
  }
});

// ---------- Show the results ----------

function showResults() {
  const failed = results.filter((result) => result.error);
  document.title = failed.length ? `FAIL ${failed.length} of ${results.length}` : `PASS ${results.length} of ${results.length}`;
  document.getElementById("summary").textContent = failed.length
    ? `${failed.length} of ${results.length} tests failed`
    : `All ${results.length} tests passed`;
  document.getElementById("results").replaceChildren(
    ...results.map((result) => {
      const item = document.createElement("li");
      item.className = result.error ? "fail" : "pass";
      item.textContent = result.error ? `FAIL: ${result.name}: ${result.error.message}` : `PASS: ${result.name}`;
      return item;
    }),
  );
}

Promise.all(unfinished).then(showResults);
