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

test("a deload is 10% under the last top weight, rounded to the weight jump, at the rep goal", () => {
  const entries = [set("2026-10-01", 135, 8), set("2026-10-01", 135, 7)];
  const deload = Logic.deloadNext(entries, "Bench Press", 8, 5);
  assertEqual([deload.weight, deload.topWeight, deload.reps], [120, 135, 8]);
});

test("a deload never drops below one weight jump", () => {
  assertEqual(Logic.deloadNext([set("2026-10-01", 5, 8)], "Bench Press", 8, 5).weight, 5);
});

test("no deload for an exercise that was never logged", () => {
  assertEqual(Logic.deloadNext([set("2026-10-01", 135, 8)], "Squat", 8, 10), null);
});

test("no second deload once the last session was already lighter than the best", () => {
  const entries = [set("2026-09-01", 135, 8), set("2026-10-01", 120, 8)];
  assertEqual(Logic.deloadNext(entries, "Bench Press", 8, 5), null);
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

// ---------- Exercise notes ----------

test("an exercise note is saved trimmed, an empty note removes it, and a long note is cut", () => {
  const notes = Logic.setExerciseNote({}, "Bench Press", "  Seat at 3  ");
  assertEqual(notes, { "Bench Press": "Seat at 3" });
  assertEqual(Logic.setExerciseNote(notes, "Squat", "Belt on"), { "Bench Press": "Seat at 3", "Squat": "Belt on" });
  assertEqual(Logic.setExerciseNote(notes, "Bench Press", "   "), {});
  assertEqual(notes, { "Bench Press": "Seat at 3" }, "the original notes must not change:");
  assertEqual(Logic.setExerciseNote({}, "Squat", "x".repeat(Logic.EXERCISE_NOTE_MAX_LENGTH + 99))["Squat"].length, Logic.EXERCISE_NOTE_MAX_LENGTH);
});

test("bad saved exercise notes are dropped and good ones kept", () => {
  const saved = { "Bench Press": " ok ", "": "no name", "Squat": 5, "Row": "   ", ["x".repeat(101)]: "name too long" };
  assertEqual(Logic.sanitizeExerciseNotes(saved), { "Bench Press": "ok" });
  assertEqual([Logic.sanitizeExerciseNotes(undefined), Logic.sanitizeExerciseNotes("text"), Logic.sanitizeExerciseNotes(null)], [{}, {}, {}]);
});

test("a note follows its exercise through a rename, and a merge keeps the exercise it merges into", () => {
  const data = () => ({
    entries: [],
    routines: [],
    customExercises: { "Cabel Fly": "Chest", "Cable Fly": "Chest" },
    exerciseNotes: { "Cabel Fly": "Handles at 4", "Cable Fly": "Handles at 6", "Bench Press": "Seat at 3" },
  });
  assertEqual(Logic.renameExercise(data(), "Cabel Fly", "Pec Fly", "Chest").exerciseNotes, { "Cable Fly": "Handles at 6", "Bench Press": "Seat at 3", "Pec Fly": "Handles at 4" });
  assertEqual(Logic.renameExercise(data(), "Cabel Fly", "Cable Fly", "Chest").exerciseNotes, { "Cable Fly": "Handles at 6", "Bench Press": "Seat at 3" }, "merging keeps the target's own note:");
  const noTargetNote = data();
  delete noTargetNote.exerciseNotes["Cable Fly"];
  assertEqual(Logic.renameExercise(noTargetNote, "Cabel Fly", "Cable Fly", "Chest").exerciseNotes, { "Bench Press": "Seat at 3", "Cable Fly": "Handles at 4" }, "merging takes the typo's note if the target has none:");
});

test("deleting an exercise deletes its note, and so does moving the last set out of a typo exercise", () => {
  const base = {
    entries: [{ id: "1", exercise: "Cabel Fly", date: "2026-10-01", weight: 30, reps: 10 }],
    routines: [],
    customExercises: { "Cabel Fly": "Chest" },
    exerciseNotes: { "Cabel Fly": "Handles at 4", "Bench Press": "Seat at 3" },
  };
  assertEqual(Logic.deleteExercise(base, "Cabel Fly").exerciseNotes, { "Bench Press": "Seat at 3" });
  const dropped = Logic.updateSetDetails(base, "1", { exercise: "Bench Press", weight: 100, reps: 5 }, "Chest");
  assertEqual([dropped.customExercises, dropped.exerciseNotes], [{}, { "Bench Press": "Seat at 3" }]);
  const stillUsed = { ...base, routines: [{ id: "r", name: "Push", exercises: ["Cabel Fly"] }] };
  assertEqual(Logic.updateSetDetails(stillUsed, "1", { exercise: "Bench Press", weight: 100, reps: 5 }, "Chest").exerciseNotes, { "Cabel Fly": "Handles at 4", "Bench Press": "Seat at 3" });
});

// ---------- Offline status ----------

test("the offline status is ready only with an active worker and saved files, and unavailable where the browser cannot do it", () => {
  const status = (supported, hasWorker, hasFiles) => Logic.offlineStatus({ supported, hasWorker, hasFiles });
  assertEqual([status(true, true, true), status(true, true, false), status(true, false, true), status(true, false, false)], ["ready", "notReady", "notReady", "notReady"]);
  assertEqual([status(false, true, true), status(false, false, false)], ["unavailable", "unavailable"]);
});

// ---------- Barbell exercises ----------

test("the built-in barbell exercises are real exercises, and the others have no plates", () => {
  for (const name of Logic.BARBELL_EXERCISES) {
    if (!(name in Logic.DEFAULT_EXERCISES)) throw new Error(`${name} is not a built-in exercise`);
  }
  const without = ["Incline Dumbbell Press", "Lateral Raise", "Lat Pulldown", "Pull-Up", "Leg Press", "Tricep Pushdown", "Plank (weighted)", "Bicep Curl"];
  assertEqual(without.map((name) => Logic.usesBarbell(name, {})), without.map(() => false));
  assertEqual(["Bench Press", "Deadlift", "Barbell Row", "Squat", "Romanian Deadlift", "Overhead Press"].map((name) => Logic.usesBarbell(name, {})), Array(6).fill(true));
});

test("an exercise someone adds has plates only when it is marked as using a barbell", () => {
  assertEqual([Logic.usesBarbell("Landmine Press", {}), Logic.usesBarbell("Landmine Press", { "Landmine Press": true }), Logic.usesBarbell("Cable Fly", { "Landmine Press": true })], [false, true, false]);
  assertEqual(Logic.sanitizeBarbellExercises({ "Landmine Press": true, "Cable Fly": false, "Row": "yes", "": true, ["x".repeat(101)]: true }), { "Landmine Press": true });
  assertEqual([Logic.sanitizeBarbellExercises(undefined), Logic.sanitizeBarbellExercises("text"), Logic.sanitizeBarbellExercises(null)], [{}, {}, {}]);
});

test("the barbell mark follows a rename as the checkbox says, a merge leaves the target alone, and a delete removes it", () => {
  const data = () => ({
    entries: [],
    routines: [],
    customExercises: { "Landmine Prss": "Shoulders", "Landmine Press": "Shoulders", "Cable Fly": "Chest" },
    exerciseNotes: {},
    barbellExercises: { "Landmine Prss": true, "Landmine Press": true },
  });
  assertEqual(Logic.renameExercise(data(), "Landmine Prss", "Landmine Raise", "Shoulders", true).barbellExercises, { "Landmine Press": true, "Landmine Raise": true });
  assertEqual(Logic.renameExercise(data(), "Landmine Prss", "Landmine Raise", "Shoulders", false).barbellExercises, { "Landmine Press": true });
  assertEqual(Logic.renameExercise(data(), "Landmine Prss", "Cable Fly", "Chest", true).barbellExercises, { "Landmine Press": true }, "merging leaves Cable Fly as it was:");
  assertEqual(Logic.deleteExercise(data(), "Landmine Prss").barbellExercises, { "Landmine Press": true });
});

test("a new exercise made from a set's Edit can be marked as barbell, and a dropped typo loses its mark", () => {
  const base = {
    entries: [{ id: "1", exercise: "Landmine Prss", date: "2026-10-01", weight: 30, reps: 10 }],
    routines: [],
    customExercises: { "Landmine Prss": "Shoulders" },
    exerciseNotes: {},
    barbellExercises: { "Landmine Prss": true },
  };
  const created = Logic.updateSetDetails(base, "1", { exercise: "Landmine Press", weight: 30, reps: 10 }, "Shoulders", true);
  assertEqual(created.barbellExercises, { "Landmine Press": true });
  const notBarbell = Logic.updateSetDetails(base, "1", { exercise: "Cable Fly", weight: 30, reps: 10 }, "Chest", false);
  assertEqual(notBarbell.barbellExercises, {});
});

// ---------- Plate calculator ----------

test("the plates for each side are the biggest ones first, for lb and kg", () => {
  const lb = (target, bar = 45) => Logic.platesPerSide(target, bar, Logic.PLATES.lb).perSide;
  const kg = (target, bar = 20) => Logic.platesPerSide(target, bar, Logic.PLATES.kg).perSide;
  assertEqual([lb(185), lb(135), lb(225), lb(45), lb(55), lb(140)], [[45, 25], [45], [45, 45], [], [5], [45, 2.5]]);
  assertEqual([kg(100), kg(60), kg(22.5), kg(142.5)], [[25, 15], [20], [1.25], [25, 25, 10, 1.25]]);
});

test("a weight the plates cannot make shows the closest load below it", () => {
  const result = Logic.platesPerSide(186, 45, Logic.PLATES.lb);
  assertEqual([result.perSide, result.loaded, result.short], [[45, 25], 185, 1]);
  const exact = Logic.platesPerSide(185, 45, Logic.PLATES.lb);
  assertEqual([exact.loaded, exact.short], [185, 0]);
});

test("a weight under the bar, or no weight, is handled instead of giving nonsense", () => {
  assertEqual(Logic.platesPerSide(30, 45, Logic.PLATES.lb).tooLight, true);
  assertEqual([Logic.platesPerSide(NaN, 45, Logic.PLATES.lb), Logic.platesPerSide(0, 45, Logic.PLATES.lb), Logic.platesPerSide(-5, 45, Logic.PLATES.lb)], [null, null, null]);
});

test("for every weight, the load is the bar plus both sides, never over, and at most one small step under", () => {
  for (const [unit, bar] of [["lb", 45], ["kg", 20]]) {
    const smallestStep = Math.min(...Logic.PLATES[unit]) * 2; // the smallest plate goes on both sides
    for (let target = bar; target <= bar + 400; target += 1.25) {
      const result = Logic.platesPerSide(target, bar, Logic.PLATES[unit]);
      const sum = bar + 2 * result.perSide.reduce((total, plate) => total + plate, 0);
      if (Math.round(sum * 1000) / 1000 !== result.loaded) throw new Error(`${target} ${unit}: the plates add up to ${sum}, not ${result.loaded}`);
      if (result.loaded > target) throw new Error(`${target} ${unit}: loaded ${result.loaded}, which is over`);
      if (result.short < 0 || result.short >= smallestStep) throw new Error(`${target} ${unit}: ${result.short} short is more than one small step`);
    }
  }
});

test("saved bar choices that are not real bars fall back to the usual bar", () => {
  assertEqual(Logic.sanitizeBarWeights({ lb: 35, kg: 15 }), { lb: 35, kg: 15 });
  assertEqual(Logic.sanitizeBarWeights({ lb: 99, kg: "heavy" }), { lb: 45, kg: 20 });
  assertEqual([Logic.sanitizeBarWeights(undefined), Logic.sanitizeBarWeights(null)], [{ lb: 45, kg: 20 }, { lb: 45, kg: 20 }]);
});

// ---------- Strength levels ----------

const kgToLb = (kg) => kg * 2.20462262;

test("the strength tables cover every lift for both sexes, with five rising levels in each bodyweight class", () => {
  assertEqual(Logic.STRENGTH_LIFTS, ["Bench Press", "Squat", "Deadlift", "Overhead Press"]);
  assertEqual(Logic.STRENGTH_SEXES, ["male", "female"]);
  for (const sex of Logic.STRENGTH_SEXES) {
    const centres = STRENGTH_DATA.bodyweightKg[sex];
    if (!centres.every((kg, i) => i === 0 || kg > centres[i - 1])) throw new Error(`${sex} class middles do not rise`);
    for (const lift of Logic.STRENGTH_LIFTS) {
      const rows = STRENGTH_DATA.lifts[lift][sex];
      assertEqual(rows.length, centres.length, `${sex} ${lift} classes:`);
      for (const row of rows) {
        assertEqual(row.length, Logic.STRENGTH_LEVELS.length, `${sex} ${lift} levels:`);
        if (!row.every((value, i) => value > 0 && (i === 0 || value > row[i - 1]))) throw new Error(`${sex} ${lift} does not rise: ${row}`);
      }
    }
  }
});

test("women's level weights are lower than men's at the same bodyweight, for every lift and level", () => {
  for (const lift of Logic.STRENGTH_LIFTS) {
    const men = Logic.strengthThresholds("male", lift, kgToLb(65));
    const women = Logic.strengthThresholds("female", lift, kgToLb(65));
    men.forEach((value, i) => {
      if (women[i] >= value) throw new Error(`${lift} level ${i}: women ${women[i]} is not below men ${value}`);
    });
  }
});

test("level weights come straight from the table at the middle of a class, are blended between classes, and stop at the ends", () => {
  const at = (kg) => Logic.strengthThresholds("male", "Bench Press", kgToLb(kg)).map((value) => Math.round(value * 10) / 10);
  assertEqual(at(78.5), [147, 174.9, 204.2, 235.2, 263.5]); // middle of the 83 kg class
  // 74 kg is 4 of the 8.5 kg between the middles of the 74 and 83 kg classes, so the median blends 181.5 and 204.2.
  assertEqual(at(74)[2], Math.round((181.5 + (204.2 - 181.5) * (4 / 8.5)) * 10) / 10);
  assertEqual(at(40), STRENGTH_DATA.lifts["Bench Press"].male[0]); // lighter than the lightest class
  assertEqual(at(200), STRENGTH_DATA.lifts["Bench Press"].male[7]); // heavier than the heaviest class
});

test("a lift is placed at the highest level whose weight it reaches, with the next target", () => {
  // Male bench at the middle of the 83 kg class: the median is 204.2 lb and the 75th percentile 235.2 lb.
  const result = Logic.strengthLevel("male", "Bench Press", 210, kgToLb(78.5));
  assertEqual([result.level, result.next.level, Math.round(result.next.weight * 10) / 10], ["Intermediate", "Advanced", 235.2]);
});

test("below the first level, at exactly a level, and at the top", () => {
  const bodyweight = kgToLb(78.5);
  assertEqual(Logic.strengthLevel("male", "Bench Press", 100, bodyweight).level, null);
  assertEqual(Logic.strengthLevel("male", "Bench Press", 100, bodyweight).next.level, "Beginner");
  assertEqual(Logic.strengthLevel("male", "Bench Press", 204.2, bodyweight).level, "Intermediate");
  const top = Logic.strengthLevel("male", "Bench Press", 400, bodyweight);
  assertEqual([top.level, top.next], ["Elite", null]);
});

test("no comparison without a sex, a known lift or a bodyweight", () => {
  assertEqual(Logic.strengthLevel("", "Squat", 200, 180), null);
  assertEqual(Logic.strengthLevel("male", "Bicep Curl", 50, 180), null);
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

// ---------- Weekly volume ----------

test("weekly volume counts sets per muscle group in each of the last weeks, newest last", () => {
  const entries = [
    set("2026-10-13", 135, 8), set("2026-10-12", 135, 8), set("2026-10-06", 135, 8), // Chest: 2 this week, 1 before
    set("2026-10-07", 200, 5, "Squat"),
  ];
  const volume = Logic.weeklyVolume(entries, muscleOf, "2026-10-14", 1, 3);
  assertEqual(volume.weeks, ["2026-09-28", "2026-10-05", "2026-10-12"]);
  assertEqual(volume.groups.map((g) => [g.group, g.counts]), [["Chest", [0, 1, 2]], ["Legs", [0, 1, 0]]]);
});

test("weekly volume leaves out sets older than the chart, but still lists the group", () => {
  const volume = Logic.weeklyVolume([set("2026-01-05", 135, 8)], muscleOf, "2026-10-14", 1);
  assertEqual([volume.weeks.length, volume.groups.map((g) => g.group), volume.groups[0].counts.every((n) => n === 0)], [8, ["Chest"], true]);
});

test("weekly volume follows where the week starts, and an empty log gives no groups", () => {
  // Sunday 11 October belongs to the week of 5 October when weeks start on Monday, and starts a new one on Sunday.
  const sunday = [set("2026-10-11", 135, 8)];
  const mondayWeeks = Logic.weeklyVolume(sunday, muscleOf, "2026-10-14", 1, 2).groups[0].counts;
  const sundayWeeks = Logic.weeklyVolume(sunday, muscleOf, "2026-10-14", 0, 2).groups[0].counts;
  assertEqual([mondayWeeks, sundayWeeks], [[1, 0], [0, 1]]);
  assertEqual(Logic.weeklyVolume([], muscleOf, "2026-10-14", 1).groups, []);
});

// ---------- Merging a backup ----------

const emptyData = () => ({
  entries: [], bodyweights: [], measurements: [], routines: [], notes: {}, customExercises: {}, exerciseNotes: {},
  barbellExercises: {}, routineSwaps: {}, unit: "lb", language: "en",
});
const setWithId = (id, date = "2026-10-01") => ({ id, date, exercise: "Bench Press", weight: 135, reps: 8 });

test("merging adds the sets this device lacks and keeps the ones it has", () => {
  const mine = { ...emptyData(), entries: [setWithId("1"), setWithId("2")] };
  const theirs = { ...emptyData(), entries: [setWithId("2"), setWithId("3")] };
  const merged = Logic.mergeBackup(mine, theirs);
  assertEqual([merged.data.entries.map((e) => e.id), merged.counts.sets], [["1", "2", "3"], 1]);
});

test("merging the same backup twice changes nothing the second time", () => {
  const mine = { ...emptyData(), notes: { "2026-10-01": "Felt strong" } };
  const theirs = {
    ...emptyData(),
    entries: [setWithId("3")], bodyweights: [{ date: "2026-10-01", weight: 180 }],
    measurements: [{ date: "2026-10-01", name: "Waist", cm: 80 }],
    routines: [{ id: "r1", name: "Push", exercises: ["Bench Press"] }],
    notes: { "2026-10-01": "Slept badly" }, customExercises: { Wrist: "Arms" }, exerciseNotes: { Squat: "Seat at 3" },
  };
  const once = Logic.mergeBackup(mine, theirs);
  assertEqual(once.counts, { sets: 1, bodyweights: 1, measurements: 1, routines: 1, notes: 1, exercises: 1 });
  const twice = Logic.mergeBackup(once.data, theirs);
  assertEqual(twice.counts, { sets: 0, bodyweights: 0, measurements: 0, routines: 0, notes: 0, exercises: 0 });
  assertEqual(twice.data, once.data);
});

test("on a clash this device wins, and notes for the same day are kept together", () => {
  const mine = {
    ...emptyData(),
    bodyweights: [{ date: "2026-10-01", weight: 180 }],
    measurements: [{ date: "2026-10-01", name: "Waist", cm: 80 }],
    routines: [{ id: "r1", name: "Push (mine)", exercises: ["Bench Press"] }],
    customExercises: { Wrist: "Arms" }, notes: { "2026-10-01": "Felt strong" }, unit: "kg", language: "fr",
  };
  const theirs = {
    ...emptyData(),
    bodyweights: [{ date: "2026-10-01", weight: 200 }],
    measurements: [{ date: "2026-10-01", name: "Waist", cm: 90 }],
    routines: [{ id: "r1", name: "Push (theirs)", exercises: ["Squat"] }],
    customExercises: { Wrist: "Chest" }, notes: { "2026-10-01": "Slept badly" }, unit: "lb", language: "en",
  };
  const { data } = Logic.mergeBackup(mine, theirs);
  assertEqual([data.bodyweights[0].weight, data.measurements[0].cm, data.routines[0].name, data.customExercises.Wrist], [180, 80, "Push (mine)", "Arms"]);
  assertEqual([data.unit, data.language], ["kg", "fr"]);
  assertEqual(data.notes["2026-10-01"], "Felt strong\nSlept badly");
});

test("merging brings in swaps, barbell marks and exercise notes this device does not have", () => {
  const mine = { ...emptyData(), barbellExercises: { Wrist: true } };
  const theirs = { ...emptyData(), barbellExercises: { Rack: true }, routineSwaps: { "2026-10-01": { r1: { 0: "Squat" } } }, exerciseNotes: { Squat: "Low bar" } };
  const { data } = Logic.mergeBackup(mine, theirs);
  assertEqual([data.barbellExercises, data.routineSwaps, data.exerciseNotes], [{ Rack: true, Wrist: true }, theirs.routineSwaps, { Squat: "Low bar" }]);
});

// ---------- Measurements named by the user ----------

test("a custom measurement name must be new, short, and not copy a built-in one in any language", () => {
  const check = (name, custom = [], shown = ["Cuello"], ignore = "") => Logic.validateCustomMeasurementName(name, custom, shown, ignore);
  assertEqual(check("Wrist"), "");
  assertEqual([check("   "), check("x".repeat(31)), check("x".repeat(30))], ["error.measureName", "error.measureNameLong", ""]);
  assertEqual([check("neck"), check("LeftArm"), check("cuello")], Array(3).fill("error.measureNameTaken"));
  assertEqual([check("wrist", ["Wrist"]), check("Wrist", ["Wrist"], ["Cuello"], "Wrist")], ["error.measureNameTaken", ""]);
});

test("saved custom names are cleaned up: repeats, built-in names and overlong names are dropped", () => {
  assertEqual(Logic.sanitizeCustomMeasurements(["Wrist", " wrist ", "Neck", "x".repeat(31), 5, "  Biceps   flexed "]), ["Wrist", "Biceps flexed"]);
  assertEqual(Logic.sanitizeCustomMeasurements("nope"), []);
});

test("custom measurements are offered after the built-in ones, and their readings are only kept while the name exists", () => {
  const readings = [{ date: "2026-10-01", name: "Wrist", cm: 17 }, { date: "2026-10-01", name: "Ghost", cm: 9 }];
  const choices = Logic.measurementChoices([], ["Wrist", "Ankle"]);
  assertEqual(choices.slice(-2), ["Ankle", "Wrist"]);
  assertEqual(choices.includes("Neck"), true);
  assertEqual(Logic.sanitizeMeasurements(readings, ["Wrist"]).map((m) => m.name), ["Wrist"]);
  assertEqual(Logic.sanitizeMeasurements(readings).length, 0);
});

test("renaming a custom measurement keeps its readings, and deleting one removes them", () => {
  const data = {
    customMeasurements: ["Wrist", "Ankle"],
    measurements: [{ date: "2026-10-01", name: "Wrist", cm: 17 }, { date: "2026-10-02", name: "Wrist", cm: 17.5 }, { date: "2026-10-01", name: "Ankle", cm: 22 }, { date: "2026-10-01", name: "Waist", cm: 80 }],
  };
  const renamed = Logic.renameCustomMeasurement(data, "Wrist", "  Left   wrist ");
  assertEqual(renamed.customMeasurements, ["Left wrist", "Ankle"]);
  assertEqual(renamed.measurements.map((m) => m.name), ["Left wrist", "Left wrist", "Ankle", "Waist"]);
  const deleted = Logic.deleteCustomMeasurement(data, "Wrist");
  assertEqual([deleted.customMeasurements, deleted.measurements.map((m) => m.name)], [["Ankle"], ["Ankle", "Waist"]]);
});

test("merging a backup adds the custom measurement names this device lacks, ignoring letter case", () => {
  const mine = { ...emptyData(), customMeasurements: ["Wrist"] };
  const theirs = { ...emptyData(), customMeasurements: ["wrist", "Ankle"], measurements: [{ date: "2026-10-01", name: "Ankle", cm: 22 }] };
  const { data, counts } = Logic.mergeBackup(mine, theirs);
  assertEqual([data.customMeasurements, counts.measurements], [["Wrist", "Ankle"], 1]);
});

// ---------- Left and right measurements ----------

test("the old Upper arm and Thigh measurements are only offered while they have readings", () => {
  const none = Logic.measurementChoices([{ date: "2026-10-01", name: "Waist", cm: 80 }]);
  assertEqual([none.includes("Arm"), none.includes("Thigh"), none.includes("LeftArm"), none.includes("RightCalf"), none.includes("Shoulders")], [false, false, true, true, true]);
  const kept = Logic.measurementChoices([{ date: "2026-10-01", name: "Arm", cm: 33 }]);
  assertEqual([kept.includes("Arm"), kept.includes("Thigh")], [true, false]);
});

test("left and right readings are compared using each side's latest reading", () => {
  const readings = [
    { date: "2026-09-01", name: "LeftArm", cm: 30 }, { date: "2026-10-01", name: "LeftArm", cm: 33 },
    { date: "2026-10-02", name: "RightArm", cm: 34.5 },
  ];
  assertEqual(Logic.leftRightGap(readings, "LeftArm"), { bigger: "right", cm: 1.5 });
  assertEqual(Logic.leftRightGap(readings, "RightArm"), { bigger: "right", cm: 1.5 });
  assertEqual(Logic.leftRightGap([...readings, { date: "2026-10-03", name: "RightArm", cm: 32 }], "LeftArm"), { bigger: "left", cm: 1 });
  assertEqual(Logic.leftRightGap([{ date: "2026-10-03", name: "LeftCalf", cm: 38 }, { date: "2026-10-03", name: "RightCalf", cm: 38 }], "RightCalf"), { bigger: "same", cm: 0 });
});

test("there is no left and right comparison until both sides have a reading, or for a measurement with no sides", () => {
  assertEqual(Logic.leftRightGap([{ date: "2026-10-01", name: "LeftArm", cm: 33 }], "LeftArm"), null);
  assertEqual(Logic.leftRightGap([{ date: "2026-10-01", name: "Waist", cm: 80 }], "Waist"), null);
  assertEqual(Logic.leftRightGap([{ date: "2026-10-01", name: "Arm", cm: 33 }], "Arm"), null);
});

test("saved readings for the new measurements are kept, and unknown names are dropped", () => {
  const saved = [{ date: "2026-10-01", name: "RightThigh", cm: 60 }, { date: "2026-10-01", name: "Elbow", cm: 30 }, { date: "2026-10-01", name: "Arm", cm: 33 }];
  assertEqual(Logic.sanitizeMeasurements(saved).map((m) => m.name), ["RightThigh", "Arm"]);
});

// ---------- Swapping a routine exercise for one day ----------

const pushRoutine = { id: "r1", exercises: ["Bench Press", "Overhead Press", "Bench Press"] };
const knownForSwaps = ["Bench Press", "Overhead Press", "Incline Press"];

test("a swap replaces one slot of the routine and leaves the others alone", () => {
  const slots = Logic.routineSlots(pushRoutine, { 2: "Incline Press" }, knownForSwaps);
  assertEqual(slots.map((s) => [s.exercise, s.original, s.swapped]), [
    ["Bench Press", "Bench Press", false], ["Overhead Press", "Overhead Press", false], ["Incline Press", "Bench Press", true],
  ]);
});

test("a swap to an exercise that no longer exists is ignored", () => {
  assertEqual(Logic.routineSlots(pushRoutine, { 0: "Gone" }, knownForSwaps)[0].exercise, "Bench Press");
  assertEqual(Logic.routineSlots(pushRoutine, undefined, knownForSwaps).every((s) => !s.swapped), true);
});

test("setting and undoing a swap changes only that day, and leaves the old data as it was", () => {
  const before = { "2026-10-23": { r1: { 0: "Incline Press" } } };
  const swapped = Logic.setRoutineSwap(before, "2026-10-24", "r1", 1, "Incline Press");
  assertEqual(swapped["2026-10-24"], { r1: { 1: "Incline Press" } });
  assertEqual(before, { "2026-10-23": { r1: { 0: "Incline Press" } } });
  assertEqual(Logic.setRoutineSwap(swapped, "2026-10-24", "r1", 1, null), before);
});

test("only the most recent days of swaps are kept", () => {
  let swaps = {};
  for (let day = 1; day <= 20; day += 1) swaps = Logic.setRoutineSwap(swaps, `2026-09-${String(day).padStart(2, "0")}`, "r1", 0, "Incline Press");
  const days = Object.keys(swaps);
  assertEqual([days.length, days[0], days[days.length - 1]], [14, "2026-09-07", "2026-09-20"]);
});

test("saved swaps that are not well formed are dropped", () => {
  assertEqual(Logic.sanitizeRoutineSwaps({ "2026-10-24": { r1: { 0: "Incline Press", x: "Squat", 1: 5 } }, nope: { r1: { 0: "Squat" } }, "2026-10-25": 3 }), {
    "2026-10-24": { r1: { 0: "Incline Press" } },
  });
  assertEqual(Logic.sanitizeRoutineSwaps(null), {});
});

// ---------- Diet: calorie target and weekly check ----------

const manPlan = { age: 30, heightCm: 180, activity: "light", goal: "maintain", pace: 1, adjust: 0 };

test("resting calories follow the Mifflin-St Jeor formula for men and women", () => {
  assertEqual(Logic.restingCalories("male", 80, 180, 30), 1780); // 800 + 1125 - 150 + 5
  assertEqual(Logic.restingCalories("female", 80, 180, 30), 1614); // the same, minus 161 instead of plus 5
});

test("the calorie target is maintenance plus or minus what the goal asks, with protein from bodyweight", () => {
  const weightLb = 80 * 2.20462262;
  const maintain = Logic.calorieTarget(manPlan, "male", weightLb);
  assertEqual([maintain.maintenance, maintain.goalChange, maintain.target, maintain.protein], [2450, 0, 2450, 141]);
  // Bulking at the steady pace of 0.5 lb a week is 250 more calories a day; cutting at 1 lb is 500 fewer.
  assertEqual(Logic.calorieTarget({ ...manPlan, goal: "bulk", pace: 1 }, "male", weightLb).target, 2700);
  assertEqual(Logic.calorieTarget({ ...manPlan, goal: "cut", pace: 1 }, "male", weightLb).target, 1950);
  assertEqual(Logic.calorieTarget({ ...manPlan, adjust: -100 }, "male", weightLb).target, 2350);
});

test("a target under the safety floor is flagged, and there is no target until everything is filled in", () => {
  const small = { age: 40, heightCm: 150, activity: "sedentary", goal: "cut", pace: 2, adjust: 0 };
  const result = Logic.calorieTarget(small, "female", 100);
  assertEqual([result.belowFloor, result.floor], [true, 1200]);
  assertEqual(Logic.calorieTarget(manPlan, "male", 180).belowFloor, false);
  for (const missing of [[{ ...manPlan, age: null }, "male", 180], [{ ...manPlan, heightCm: null }, "male", 180], [manPlan, "", 180], [manPlan, "male", 0]]) {
    assertEqual(Logic.calorieTarget(...missing), null);
  }
});

test("saved diet details that are wrong fall back to the defaults, and good ones are kept", () => {
  assertEqual(Logic.sanitizeDiet(null), Logic.DEFAULT_DIET);
  assertEqual(Logic.sanitizeDiet({ age: 5, heightCm: 20, activity: "extreme", goal: "feast", pace: 9, adjust: 9999 }), Logic.DEFAULT_DIET);
  const good = { age: 25, heightCm: 178, activity: "active", goal: "bulk", pace: 2, adjust: -150 };
  assertEqual(Logic.sanitizeDiet(good), good);
});

test("age and height are checked", () => {
  assertEqual([Logic.validateAge(30), Logic.validateAge(13), Logic.validateAge(101), Logic.validateAge(30.5), Logic.validateAge(NaN)], ["", "error.age", "error.age", "error.age", "error.age"]);
  assertEqual([Logic.validateHeight(180), Logic.validateHeight(99), Logic.validateHeight(251), Logic.validateHeight(NaN)], ["", "error.height", "error.height", "error.height"]);
});

test("a height in centimetres converts to feet and inches and back, carrying whole feet", () => {
  assertEqual(Logic.cmToFeetInches(177.8), { feet: 5, inches: 10 });
  assertEqual(Logic.cmToFeetInches(182.88), { feet: 6, inches: 0 });
  assertEqual(Logic.cmToFeetInches(182.85), { feet: 6, inches: 0 }); // 71.99 in rounds up to the next foot
  assertEqual(Logic.cmToFeetInches(175), { feet: 5, inches: 8.9 });
  assertEqual(Math.round(Logic.feetInchesToCm(5, 10) * 10) / 10, 177.8);
  assertEqual(Math.round(Logic.feetInchesToCm(5, undefined) * 10) / 10, 152.4);
  assertEqual(Math.round(Logic.feetInchesToCm(undefined, 70) * 10) / 10, 177.8);
});

test("the weight trend is the weekly change over the last three weeks, and needs enough readings", () => {
  const weights = [{ date: "2026-10-01", weight: 180 }, { date: "2026-10-08", weight: 180.5 }, { date: "2026-10-15", weight: 181 }, { date: "2026-10-22", weight: 181.5 }];
  const trend = Logic.weightTrend([{ date: "2026-08-01", weight: 150 }, ...weights], "2026-10-22");
  assertEqual([Math.round(trend.perWeek * 100) / 100, trend.count, trend.days], [0.5, 4, 21]);
  assertEqual(Logic.weightTrend(weights.slice(0, 2), "2026-10-22"), null); // two readings are not a trend
  assertEqual(Logic.weightTrend([{ date: "2026-10-18", weight: 180 }, { date: "2026-10-20", weight: 181 }, { date: "2026-10-22", weight: 182 }], "2026-10-22"), null); // too close together
});

test("the weekly check suggests more or fewer calories, in steps of 50, and calls a close match on track", () => {
  assertEqual(Logic.adjustmentSuggestion(0.5, 1.2), { status: "adjust", change: -350 }); // gaining too fast: eat less
  assertEqual(Logic.adjustmentSuggestion(-1, -0.4), { status: "adjust", change: -300 }); // cutting too slowly: eat less
  assertEqual(Logic.adjustmentSuggestion(0.5, -0.4), { status: "adjust", change: 450 }); // not gaining: eat more
  assertEqual(Logic.adjustmentSuggestion(0.5, 0.45), { status: "onTrack" });
  assertEqual(Logic.adjustmentSuggestion(1, -2).change, Logic.MAX_ADJUSTMENT); // never more than the cap
});

// ---------- Warm-up sets ----------

test("warm-up sets ramp up to the working weight with fewer reps, using weights the plates can make", () => {
  assertEqual(Logic.warmupSets(135, 45, Logic.PLATES.lb), [
    { weight: 45, reps: 10 }, { weight: 65, reps: 5 }, { weight: 90, reps: 3 }, { weight: 110, reps: 1 },
  ]);
  assertEqual(Logic.warmupSets(100, 20, Logic.PLATES.kg), [
    { weight: 20, reps: 10 }, { weight: 50, reps: 5 }, { weight: 70, reps: 3 }, { weight: 85, reps: 1 },
  ]);
});

test("warm-up steps that repeat a weight are dropped, so a light lift gets a short ramp", () => {
  assertEqual(Logic.warmupSets(75, 45, Logic.PLATES.lb), [
    { weight: 45, reps: 10 }, { weight: 50, reps: 3 }, { weight: 60, reps: 1 },
  ]);
});

test("a working weight within one and a half bars needs no warm-up", () => {
  assertEqual(Logic.warmupSets(65, 45, Logic.PLATES.lb), []);
  assertEqual(Logic.warmupSets(45, 45, Logic.PLATES.lb), []);
  assertEqual(Logic.warmupSets(30, 20, Logic.PLATES.kg), []);
});

test("every warm-up weight is lighter than the working weight and the weights only go up", () => {
  for (const unit of ["lb", "kg"]) {
    const bar = Logic.DEFAULT_BARS[unit];
    for (let weight = bar; weight <= bar + 400; weight += 2.5) {
      const sets = Logic.warmupSets(weight, bar, Logic.PLATES[unit]);
      const weights = sets.map((s) => s.weight);
      if (weights.some((w, i) => w >= weight || (i > 0 && w <= weights[i - 1]))) throw new Error(`bad ramp for ${weight} ${unit}`);
    }
  }
});

test("working sets leave out warm-ups, so they never count as a record", () => {
  const entries = [set("2026-10-01", 135, 8), { ...set("2026-10-02", 300, 1), warmup: true }];
  assertEqual(Logic.workingSets(entries).length, 1);
  assertEqual(Logic.personalRecords(Logic.workingSets(entries))[0].weight, 135);
});

// ---------- Personal records ----------

test("a personal record is the heaviest weight, dated the first time it was lifted", () => {
  const entries = [set("2026-10-10", 140, 6), set("2026-10-01", 135, 8), set("2026-10-05", 140, 8), set("2026-10-05", 140, 5)];
  assertEqual(Logic.personalRecords(entries), [{ exercise: "Bench Press", weight: 140, reps: 8, date: "2026-10-05" }]);
});

test("the reps shown are the most done at the record weight on its first day", () => {
  const entries = [set("2026-10-05", 140, 5), set("2026-10-05", 140, 8), set("2026-10-02", 135, 12)];
  assertEqual(Logic.personalRecords(entries)[0].reps, 8);
});

test("personal records list the newest record first, one per exercise", () => {
  const entries = [set("2026-10-01", 200, 5, "Squat"), set("2026-10-09", 135, 8), set("2026-10-09", 100, 8, "Barbell Row")];
  assertEqual(Logic.personalRecords(entries).map((r) => [r.exercise, r.date]), [
    ["Barbell Row", "2026-10-09"], ["Bench Press", "2026-10-09"], ["Squat", "2026-10-01"],
  ]);
});

test("exercises logged with no weight have no personal record", () => {
  assertEqual(Logic.personalRecords([set("2026-10-01", 0, 12, "Pull-up")]), []);
  assertEqual(Logic.personalRecords([]), []);
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
const TAB_NAMES = ["log", "routines", "history", "progress", "plan", "weight"];

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
    diet: { age: 30, heightCm: 178, activity: "active", goal: "bulk", pace: 1, adjust: 0 },
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
      plan: ["#plan-sex", "#plan-result .plan-card"],
      weight: ["#diet-weight-chart svg", "#diet-check"],
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

test("the Log tab shows the date, exercise, weight, reps and Add set on the first screen", async () => {
  const app = await openApp();
  try {
    // Choosing an exercise with history brings up the tips row and the suggestion, the tallest case.
    const exercise = app.doc.getElementById("exercise");
    exercise.value = "Bench Press";
    exercise.dispatchEvent(new Event("input", { bubbles: true }));
    const tabBarTop = app.doc.querySelector(".tabbar").getBoundingClientRect().top;
    for (const selector of ["#date", "#exercise", "#weight", "#reps", "#log-form button.primary"]) {
      const box = app.doc.querySelector(selector).getBoundingClientRect();
      if (box.top < 0 || box.bottom > tabBarTop) {
        throw new Error(`${selector} ends at ${Math.round(box.bottom)}px but the first screen ends at ${Math.round(tabBarTop)}px`);
      }
    }
    if (app.errors.length) throw new Error(`the app raised errors: ${app.errors.join("; ")}`);
  } finally {
    closeApp(app);
  }
});

test("History is short: the recent days as one line per exercise, the older days folded away", async () => {
  const app = await openApp();
  try {
    const tab = showTab(app, "history");
    const days = tab.querySelectorAll("#history > .day");
    const fold = tab.querySelector("#history > details.older-days");
    if (days.length !== 7) throw new Error(`expected 7 recent days, found ${days.length}`);
    if (!fold || fold.open || fold.querySelectorAll(".day").length === 0) throw new Error("the older days should be folded away, with days inside");
    const line = tab.querySelector("#history .exercise-line");
    if (line.open) throw new Error("an exercise line should start closed");
    if (!/\d+×\d+/.test(line.querySelector(".exercise-sets").textContent)) throw new Error("the line should summarise its sets, like 145×8");
    const screens = app.doc.documentElement.scrollHeight / 812;
    if (screens > 4) throw new Error(`History is ${screens.toFixed(1)} screens tall; it used to be about 8`);
    if (app.errors.length) throw new Error(`the app raised errors: ${app.errors.join("; ")}`);
  } finally {
    closeApp(app);
  }
});

test("tapping an exercise line opens its sets, and editing a set keeps that line open", async () => {
  const app = await openApp();
  try {
    const tab = showTab(app, "history");
    const line = tab.querySelector("#history .exercise-line");
    line.querySelector("summary").click();
    await new Promise((resolve) => setTimeout(resolve, 0)); // the page notes the line is open
    if (!line.open || line.querySelectorAll(".entry").length === 0) throw new Error("tapping the line should open its sets");
    line.querySelector(".entry button.link").click(); // Edit on the first set
    const reopened = tab.querySelector("#history .exercise-line");
    if (!reopened.open || !reopened.querySelector(".entry.editing form")) throw new Error("the set being edited should stay on screen");
  } finally {
    closeApp(app);
  }
});

test("the calendar's jump opens the folded older days to reach a day", async () => {
  const app = await openApp();
  try {
    const tab = showTab(app, "history");
    const fold = tab.querySelector("details.older-days");
    const oldest = [...fold.querySelectorAll(".day")].pop();
    app.win.showHistoryDay(oldest.id.replace("day-", ""));
    if (!fold.open) throw new Error("the older days should have opened");
  } finally {
    closeApp(app);
  }
});

test("Weekly volume shows a row per trained muscle group with a bar for each of the last 8 weeks", async () => {
  const app = await openApp();
  try {
    const tab = showTab(app, "progress");
    const rows = [...tab.querySelectorAll("#volume-groups .volume-row")];
    if (rows.length === 0) throw new Error("no muscle group rows in Weekly volume");
    for (const row of rows) {
      if (row.querySelectorAll(".volume-bar").length !== 8) throw new Error("each row needs 8 weekly bars");
      if (row.querySelectorAll(".volume-bar.current").length !== 1) throw new Error("only the newest bar is highlighted");
    }
    if (!/this week/i.test(rows[0].querySelector(".volume-head").textContent)) throw new Error("the row should say how many sets this week");
    if (app.errors.length) throw new Error(app.errors.join("; "));
  } finally {
    closeApp(app);
  }
});

test("Personal records lists each lifted exercise with its heaviest weight and date, newest first", async () => {
  const app = await openApp();
  try {
    const tab = showTab(app, "progress");
    const rows = [...tab.querySelectorAll("#records-list .record-row")];
    if (rows.length === 0) throw new Error("no rows in Personal records");
    if (!rows.every((row) => /\d.*×.*\d/.test(row.textContent))) throw new Error("each record should show weight × reps and a date");
    if (app.errors.length) throw new Error(app.errors.join("; "));
  } finally {
    closeApp(app);
  }
});

test("Progress opens with the plateau check and exercise chart, and the other sections are folded", async () => {
  const app = await openApp();
  try {
    const tab = showTab(app, "progress");
    const folds = [...tab.querySelectorAll("details.section-fold")];
    if (folds.length !== 6) throw new Error(`expected 6 folded sections, found ${folds.length}`);
    if (folds.some((fold) => fold.open)) throw new Error("the folded sections should start closed");
    const chart = tab.querySelector("#exercise-chart svg").getBoundingClientRect();
    if (chart.bottom > 812 * 1.5) throw new Error(`the exercise chart ends ${Math.round(chart.bottom)}px down; it should be near the top`);
    const screens = app.doc.documentElement.scrollHeight / 812;
    if (screens > 2.2) throw new Error(`Progress is ${screens.toFixed(1)} screens tall; it used to be about 3.3`);
    // Opening Bodyweight shows its form and chart.
    const bodyweight = folds.find((fold) => fold.querySelector("#bodyweight-form"));
    bodyweight.querySelector("summary").click();
    if (!bodyweight.open || bodyweight.querySelector("#bodyweight").getBoundingClientRect().width === 0) throw new Error("tapping Bodyweight should open its form");
    if (app.errors.length) throw new Error(`the app raised errors: ${app.errors.join("; ")}`);
  } finally {
    closeApp(app);
  }
});

test("every tap-to-open heading shows an arrow that flips when it opens", async () => {
  const app = await openApp();
  try {
    const style = (summary) => app.win.getComputedStyle(summary, "::after");
    const exercise = app.doc.getElementById("exercise");
    exercise.value = "Bench Press"; // shows the tips row and the suggestion on the Log tab
    exercise.dispatchEvent(new Event("input", { bubbles: true }));
    let checked = 0;
    for (const name of TAB_NAMES) {
      const tab = showTab(app, name);
      // Only headings that are on screen can be measured (a hidden one has no drawn arrow).
      for (const summary of [...tab.querySelectorAll("details > summary")].filter((node) => node.getClientRects().length > 0)) {
        const arrow = style(summary);
        // The arrow is a drawn corner (two borders), turned to point down while the heading is closed.
        if (arrow.content === "none" || !(parseFloat(arrow.borderRightWidth) > 0) || arrow.transform === "none") {
          throw new Error(`"${summary.textContent.trim().slice(0, 30)}" on the ${name} tab has no arrow`);
        }
        checked += 1;
      }
    }
    if (checked < 12) throw new Error(`expected many tap-to-open headings, checked only ${checked}`);
    // Turn the animation off in this hidden copy, so the arrow's final position can be read at once.
    const noAnimation = app.doc.createElement("style");
    noAnimation.textContent = "summary::after { transition: none !important; }";
    app.doc.head.append(noAnimation);
    const fold = showTab(app, "progress").querySelector("details.section-fold");
    const closedArrow = style(fold.querySelector("summary")).transform;
    fold.open = true;
    if (style(fold.querySelector("summary")).transform === closedArrow) throw new Error("the arrow should flip when the heading opens");
  } finally {
    closeApp(app);
  }
});

test("the stylesheet respects Reduce Motion, and every animation it uses is defined", async () => {
  const css = await (await fetch("style.css", { cache: "no-store" })).text();
  const reduce = css.match(/@media \(prefers-reduced-motion: reduce\)\s*\{[\s\S]*$/);
  if (!reduce) throw new Error("style.css has no Reduce Motion rule");
  for (const needed of ["animation-duration: 0.001ms !important", "transition-duration: 0.001ms !important"]) {
    if (!reduce[0].includes(needed)) throw new Error(`the Reduce Motion rule is missing: ${needed}`);
  }
  const used = new Set([...css.matchAll(/animation:\s*([a-z][\w-]*)/g)].map((match) => match[1]));
  const defined = new Set([...css.matchAll(/@keyframes\s+([\w-]+)/g)].map((match) => match[1]));
  const undefinedNames = [...used].filter((name) => !defined.has(name));
  if (used.size < 7) throw new Error(`expected the new animations, found ${used.size}`);
  if (undefinedNames.length) throw new Error(`animations without keyframes: ${undefinedNames.join(", ")}`);
});

test("a tab fades in, a chart line draws in, and an opened section eases open", async () => {
  const app = await openApp();
  try {
    const animationOf = (node) => app.win.getComputedStyle(node).animationName;
    const progress = showTab(app, "progress");
    assertEqual(animationOf(progress), "tab-in");
    const line = progress.querySelector("#exercise-chart path.line");
    if (!line || line.getAttribute("pathLength") !== "1") throw new Error("the chart line should be a path with pathLength 1, so it can draw in");
    assertEqual(animationOf(line), "draw-line");
    const fold = progress.querySelector("details.section-fold");
    fold.open = true;
    assertEqual(animationOf(fold.querySelector(":scope > :not(summary)")), "fold-in");
  } finally {
    closeApp(app);
  }
});

test("a set that was just added flashes, and its routine chip pulses", async () => {
  const app = await openApp();
  try {
    const routine = app.doc.getElementById("routine-select");
    routine.value = "r1";
    routine.dispatchEvent(new Event("change", { bubbles: true }));
    app.doc.querySelector("#routine-checklist .chip").click(); // Bench Press
    app.doc.getElementById("weight").value = "100";
    app.doc.getElementById("reps").value = "8";
    app.doc.getElementById("log-form").requestSubmit();
    const added = app.doc.querySelectorAll("#today-list .entry.just-added");
    if (added.length !== 1) throw new Error(`expected 1 new set to flash, found ${added.length}`);
    assertEqual(app.win.getComputedStyle(added[0]).animationName, "row-in");
    const pulsing = app.doc.querySelectorAll("#routine-checklist .chip.pulse");
    if (pulsing.length !== 1) throw new Error(`expected 1 chip to pulse, found ${pulsing.length}`);
    assertEqual(app.win.getComputedStyle(pulsing[0]).animationName, "pulse");
    // Drawing the list again later (a tab change, say) must not replay the flash.
    showTab(app, "history");
    showTab(app, "log");
    assertEqual(app.doc.querySelectorAll("#today-list .entry.just-added").length, 0);
  } finally {
    closeApp(app);
  }
});

// Logs a set through the real form of an open copy of the app.
function logSetInApp(app, exercise, weight, reps) {
  const exerciseBox = app.doc.getElementById("exercise");
  exerciseBox.value = exercise;
  exerciseBox.dispatchEvent(new Event("input", { bubbles: true }));
  app.doc.getElementById("weight").value = String(weight);
  app.doc.getElementById("reps").value = String(reps);
  app.doc.getElementById("log-form").requestSubmit();
}

test("a brand-new app offers sample data on the Log tab, and the offer goes away once there is data", async () => {
  const app = await openApp();
  try {
    const offer = app.doc.getElementById("log-sample");
    if (!offer.classList.contains("hidden")) throw new Error("an app with workouts in it should not offer sample data");
    // Empty the app the way a first visit looks, then redraw the Log tab.
    app.win.eval("state.entries = []; state.notes = {}; renderToday();");
    if (offer.classList.contains("hidden")) throw new Error("an empty app should offer sample data on the Log tab");
    const button = app.doc.getElementById("load-sample-log");
    if (button.getBoundingClientRect().width === 0 || button.textContent.trim() === "") throw new Error("the sample data button should be visible and labelled");
    button.click();
    if (!offer.classList.contains("hidden")) throw new Error("the offer should go away after the sample data is loaded");
    if (JSON.parse(app.win.localStorage.getItem(app.storage)).entries.length === 0) throw new Error("loading should save sample workouts");
    if (app.errors.length) throw new Error(app.errors.join("; "));
  } finally {
    closeApp(app);
  }
});

test("the rest timer is one slim row, with Adjust hiding the time buttons, and Skip ends it", async () => {
  const app = await openApp();
  try {
    const doc = app.doc;
    logSetInApp(app, "Bench Press", 135, 8);
    const banner = doc.getElementById("rest-banner");
    if (banner.classList.contains("hidden")) throw new Error("logging a set should start the rest timer");
    const height = banner.getBoundingClientRect().height;
    if (height > 80) throw new Error(`the rest row is ${Math.round(height)}px tall; it should be one slim row (it used to be about 250px)`);
    // The form's main controls stay on the first screen while the timer runs.
    const tabBarTop = doc.querySelector(".tabbar").getBoundingClientRect().top;
    const addSet = doc.querySelector("#log-form button.primary").getBoundingClientRect();
    if (addSet.bottom > tabBarTop) throw new Error(`Add set ends at ${Math.round(addSet.bottom)}px, below the first screen (${Math.round(tabBarTop)}px)`);
    const adjust = doc.getElementById("rest-adjust");
    const toggle = doc.getElementById("rest-adjust-toggle");
    if (!adjust.classList.contains("hidden")) throw new Error("the time buttons should start tucked away");
    const clock = () => doc.getElementById("rest-clock").textContent;
    const before = clock();
    toggle.click();
    if (adjust.classList.contains("hidden") || toggle.getAttribute("aria-expanded") !== "true") throw new Error("Adjust should show the time buttons");
    adjust.querySelector('button[data-delta="15"]').click();
    if (clock() === before) throw new Error(`+15s should change the clock, which still reads ${before}`);
    toggle.click();
    if (!adjust.classList.contains("hidden")) throw new Error("tapping Adjust again should tuck the buttons away");
    doc.getElementById("rest-skip").click();
    if (!banner.classList.contains("hidden")) throw new Error("Skip should end the rest row");
    if (app.errors.length) throw new Error(app.errors.join("; "));
  } finally {
    closeApp(app);
  }
});

test("Repeat adds another set that copies the last one and is saved like any other set", async () => {
  const app = await openApp();
  try {
    app.win.Date.now = () => 1000; // every set is saved in the "same millisecond"; ids must still differ
    logSetInApp(app, "Bench Press", 100, 8);
    const button = app.doc.querySelector("#today-list .repeat-set");
    if (!button || !button.textContent.includes("100 lb × 8 reps")) throw new Error(`the Repeat button should name the set it will add, but reads "${button && button.textContent}"`);
    button.click();
    assertEqual(app.doc.querySelectorAll("#today-list .entry").length, 2);
    const saved = JSON.parse(localStorage.getItem(app.storage)).entries.filter((entry) => entry.exercise === "Bench Press" && entry.weight === 100);
    assertEqual(saved.map((entry) => entry.reps), [8, 8]);
    assertEqual(saved[0].date, saved[1].date);
    if (saved[0].id === saved[1].id) throw new Error("two sets saved together must not share an id");
    if (app.doc.getElementById("rest-banner").classList.contains("hidden")) throw new Error("repeating a set should start the rest timer");
    if (!app.doc.getElementById("toast").textContent.includes("set 2")) throw new Error(`expected the Saved message for set 2, saw "${app.doc.getElementById("toast").textContent}"`);
    assertEqual(app.doc.querySelectorAll("#today-list .entry.just-added").length, 1);
    if (!app.doc.querySelector("#today-list .repeat-set").textContent.includes("100 lb × 8 reps")) throw new Error("the button should still offer the same set");
    if (app.errors.length) throw new Error(`the app raised errors: ${app.errors.join("; ")}`);
  } finally {
    closeApp(app);
  }
});

test("Repeat adds the set to the day shown, and copies the most recent set of that exercise", async () => {
  const app = await openApp();
  try {
    const date = app.doc.getElementById("date");
    // A day long before the sample data (which is dated back from today), so nothing else is logged on it.
    date.value = "2020-01-02";
    date.dispatchEvent(new Event("change", { bubbles: true }));
    logSetInApp(app, "Squat", 200, 5);
    logSetInApp(app, "Squat", 210, 4);
    app.doc.querySelector("#today-list .repeat-set").click();
    const onThatDay = JSON.parse(localStorage.getItem(app.storage)).entries.filter((entry) => entry.date === "2020-01-02" && entry.exercise === "Squat");
    assertEqual(onThatDay.map((entry) => `${entry.weight}x${entry.reps}`), ["200x5", "210x4", "210x4"]);
  } finally {
    closeApp(app);
  }
});

// ---------- Everyday use, as a person would do it ----------

// Helpers for the tests below. They use a day long before the sample data (which is dated back from today),
// so the only sets on it are the ones the test logs itself.
const QUIET_DAY = "2020-03-04";
const fireEvent = (node, type) => node.dispatchEvent(new Event(type, { bubbles: true, cancelable: true }));
const savedData = (app) => JSON.parse(app.win.localStorage.getItem(app.storage));
const setsOnQuietDay = (app) => savedData(app).entries.filter((entry) => entry.date === QUIET_DAY);

function chooseDay(app, date) {
  const box = app.doc.getElementById("date");
  box.value = date;
  fireEvent(box, "change");
}

// Picks a file in the backup chooser and waits until the app has answered: either the panel with the
// choices, or an error message. Reading a file takes a moment, so this waits for the answer instead of
// guessing how long it takes.
async function chooseBackupFile(app, text) {
  const files = new app.win.DataTransfer();
  files.items.add(new app.win.File([text], "backup.json", { type: "application/json" }));
  const input = app.doc.getElementById("backup-file");
  const error = app.doc.getElementById("backup-error");
  const panel = app.doc.getElementById("backup-merge");
  error.textContent = "";
  input.files = files.files;
  fireEvent(input, "change");
  for (let waited = 0; waited < 3000 && !error.textContent && panel.classList.contains("hidden"); waited += 50) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

// A second copy of the app on the same saved data, like closing the page and opening it again.
function reopenApp(app) {
  return new Promise((resolve) => {
    const frame = document.createElement("iframe");
    frame.style.cssText = "position: absolute; left: -9999px; width: 375px; height: 812px; border: 0;";
    frame.src = `index.html?storage=${app.storage}`;
    frame.addEventListener("load", () => resolve({ frame, doc: frame.contentDocument, win: frame.contentWindow }));
    document.body.append(frame);
  });
}

test("logging a set saves it, lists it, and keeps the weight and reps for the next set", async () => {
  const app = await openApp();
  try {
    chooseDay(app, QUIET_DAY);
    logSetInApp(app, "Squat", 225, 5);
    const list = app.doc.getElementById("today-list");
    if (!list.textContent.includes("Set 1") || !list.textContent.includes("225 lb × 5 reps")) throw new Error(`the list reads "${list.textContent}"`);
    assertEqual(setsOnQuietDay(app).map((e) => [e.exercise, e.weight, e.reps]), [["Squat", 225, 5]]);
    assertEqual([app.doc.getElementById("weight").value, app.doc.getElementById("reps").value], ["225", "5"]);
    logSetInApp(app, "Squat", 225, 4);
    if (!list.textContent.includes("Set 2")) throw new Error("the second set should be numbered Set 2");
    if (!app.doc.getElementById("toast").textContent.includes("Squat")) throw new Error("saving should show a message naming the exercise");
    if (app.errors.length) throw new Error(app.errors.join("; "));
  } finally {
    closeApp(app);
  }
});

test("a set with missing or wrong details is refused with a message and nothing is saved", async () => {
  const app = await openApp();
  try {
    chooseDay(app, QUIET_DAY);
    const error = () => app.doc.getElementById("form-error").textContent;
    for (const [exercise, weight, reps] of [["", 100, 5], ["Squat", 100, 0], ["Squat", 100, "abc"], ["Squat", -5, 5], ["Squat", 100, 101]]) {
      logSetInApp(app, exercise, weight, reps);
      if (!error()) throw new Error(`"${exercise}" ${weight} x ${reps} should have shown an error`);
      assertEqual(setsOnQuietDay(app).length, 0, `${exercise} ${weight} x ${reps}:`);
    }
    logSetInApp(app, "Squat", 100, 5);
    assertEqual([error(), setsOnQuietDay(app).length], ["", 1]);
  } finally {
    closeApp(app);
  }
});

test("a set heavier than the best so far gets a New record message, and a lighter one does not", async () => {
  const app = await openApp();
  try {
    chooseDay(app, QUIET_DAY);
    const toast = app.doc.getElementById("toast");
    logSetInApp(app, "Bench Press", 500, 1);
    if (!toast.classList.contains("record") || !toast.textContent.includes("New record")) throw new Error(`a 500 lb bench should be a record, but the message reads "${toast.textContent}"`);
    logSetInApp(app, "Bench Press", 100, 8);
    if (toast.classList.contains("record")) throw new Error("a lighter set must not give a record message");
  } finally {
    closeApp(app);
  }
});

test("editing a set changes it, a bad value is refused, and Escape leaves it as it was", async () => {
  const app = await openApp();
  try {
    chooseDay(app, QUIET_DAY);
    logSetInApp(app, "Squat", 225, 5);
    const doc = app.doc;
    const editButton = () => [...doc.querySelectorAll("#today-list .entry button.link")].find((button) => button.textContent === "Edit");
    editButton().click();
    const [weight, reps] = doc.querySelectorAll("#today-list .entry.editing input[type=number]");
    const form = doc.querySelector("#today-list .entry.editing form");
    reps.value = "0";
    fireEvent(form, "submit");
    if (!doc.querySelector("#today-list .entry.editing .error").textContent) throw new Error("0 reps should be refused with a message");
    assertEqual(setsOnQuietDay(app)[0].reps, 5);
    weight.value = "230";
    reps.value = "6";
    fireEvent(form, "submit");
    if (!doc.getElementById("today-list").textContent.includes("230 lb × 6 reps")) throw new Error("the list should show the edited set");
    assertEqual(setsOnQuietDay(app).map((e) => [e.weight, e.reps]), [[230, 6]]);
    // Escape closes the editor without saving what was typed.
    editButton().click();
    const typed = doc.querySelectorAll("#today-list .entry.editing input[type=number]")[0];
    typed.value = "999";
    typed.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    if (doc.querySelector("#today-list .entry.editing")) throw new Error("Escape should close the editor");
    assertEqual(setsOnQuietDay(app)[0].weight, 230);
    if (app.errors.length) throw new Error(app.errors.join("; "));
  } finally {
    closeApp(app);
  }
});

test("deleting a set removes it from the list and from the saved data", async () => {
  const app = await openApp();
  try {
    chooseDay(app, QUIET_DAY);
    logSetInApp(app, "Squat", 225, 5);
    logSetInApp(app, "Squat", 215, 5);
    const deleteButtons = () => [...app.doc.querySelectorAll("#today-list .entry button.link")].filter((button) => button.textContent === "Delete");
    deleteButtons()[0].click();
    assertEqual(setsOnQuietDay(app).map((e) => e.weight), [215]);
    deleteButtons()[0].click();
    assertEqual(setsOnQuietDay(app).length, 0);
    if (!app.doc.getElementById("today-list").textContent.includes("Nothing logged")) throw new Error("an empty day should say nothing is logged");
  } finally {
    closeApp(app);
  }
});

test("logged sets are still there after the app is closed and opened again", async () => {
  const app = await openApp();
  let again;
  try {
    chooseDay(app, QUIET_DAY);
    logSetInApp(app, "Squat", 225, 5);
    again = await reopenApp(app);
    const date = again.doc.getElementById("date");
    date.value = QUIET_DAY;
    fireEvent(date, "change");
    if (!again.doc.getElementById("today-list").textContent.includes("225 lb × 5 reps")) throw new Error("the set should still be listed after reopening");
  } finally {
    if (again) again.frame.remove();
    closeApp(app);
  }
});

test("a routine can be built, started on the Log tab, and deleted", async () => {
  const app = await openApp();
  try {
    const doc = app.doc;
    showTab(app, "routines");
    const name = doc.getElementById("routine-name");
    fireEvent(doc.getElementById("routine-form"), "submit");
    if (!doc.getElementById("routine-error").textContent) throw new Error("a routine with no name or exercises should be refused");
    name.value = "Leg Day";
    for (const exercise of ["Squat", "Romanian Deadlift"]) {
      doc.getElementById("routine-exercise-select").value = exercise;
      doc.getElementById("routine-add-exercise").click();
    }
    fireEvent(doc.getElementById("routine-form"), "submit");
    const made = savedData(app).routines.find((routine) => routine.name === "Leg Day");
    if (!made) throw new Error("the routine should be saved");
    assertEqual(made.exercises, ["Squat", "Romanian Deadlift"]);
    // Start it on the Log tab: its exercises appear as chips.
    showTab(app, "log");
    const picker = doc.getElementById("routine-select");
    picker.value = made.id;
    fireEvent(picker, "change");
    assertEqual([...doc.querySelectorAll("#routine-checklist .chip")].map((chip) => chip.textContent), ["Squat", "Romanian Deadlift"]);
    // Delete it.
    showTab(app, "routines");
    const card = [...doc.querySelectorAll("#routine-list .routine-card")].find((candidate) => candidate.textContent.includes("Leg Day"));
    [...card.querySelectorAll("button.link")].find((button) => button.textContent === "Delete").click();
    if (savedData(app).routines.some((routine) => routine.name === "Leg Day")) throw new Error("the routine should be gone");
    if (app.errors.length) throw new Error(app.errors.join("; "));
  } finally {
    closeApp(app);
  }
});

test("a downloaded backup holds everything, and Replace everything puts that back, undoing later changes", async () => {
  const app = await openApp();
  try {
    const doc = app.doc;
    // Catch the file the app offers for download instead of really downloading it.
    let downloaded = null;
    app.win.URL.createObjectURL = (file) => {
      downloaded = file;
      return "blob:test";
    };
    app.win.HTMLAnchorElement.prototype.click = () => {};
    const before = savedData(app);
    doc.getElementById("backup-download").click();
    if (!downloaded) throw new Error("Download backup should offer a file");
    const text = await downloaded.text();
    assertEqual(Logic.parseBackup(text).data.entries.length, before.entries.length);
    // Change things, then restore.
    chooseDay(app, QUIET_DAY);
    logSetInApp(app, "Squat", 225, 5);
    assertEqual(savedData(app).entries.length, before.entries.length + 1);
    await chooseBackupFile(app, text);
    app.win.confirm = () => false;
    doc.getElementById("backup-replace-go").click();
    assertEqual(savedData(app).entries.length, before.entries.length + 1, "declining the warning:");
    app.win.confirm = () => true;
    doc.getElementById("backup-replace-go").click();
    assertEqual(savedData(app).entries.length, before.entries.length, "after replacing:");
    if (!doc.getElementById("backup-merge").classList.contains("hidden")) throw new Error("the panel should close after replacing");
    if (app.errors.length) throw new Error(app.errors.join("; "));
  } finally {
    closeApp(app);
  }
});

test("a file that is not a backup is refused with a message and changes nothing", async () => {
  const app = await openApp();
  try {
    const before = JSON.stringify(savedData(app));
    for (const text of ["hello", "{}", JSON.stringify({ app: "something-else", data: {} })]) {
      await chooseBackupFile(app, text);
      if (!app.doc.getElementById("backup-error").textContent) throw new Error(`"${text}" should show an error`);
      if (!app.doc.getElementById("backup-merge").classList.contains("hidden")) throw new Error("no panel should show for a bad file");
      assertEqual(JSON.stringify(savedData(app)), before, `"${text}":`);
    }
  } finally {
    closeApp(app);
  }
});

// ---------- The Diet section ----------

// The number in a line such as "2,975 calories a day".
const caloriesIn = (text) => Number(text.replace(/[^\d]/g, ""));

function setPlanFields(app, fields) {
  for (const [id, value] of Object.entries(fields)) {
    const box = app.doc.getElementById(id);
    box.value = value;
    fireEvent(box, "change");
  }
}

test("the Workout and Diet switch changes the tabs along the bottom, and the app opens on the section you left", async () => {
  const app = await openApp();
  let again;
  try {
    const doc = app.doc;
    const shown = (id) => !doc.getElementById(id).classList.contains("hidden");
    assertEqual(["nav-log", "nav-plan"].map(shown), [true, false]);
    doc.querySelector('.section-switch button[data-section="diet"]').click();
    assertEqual(["nav-log", "nav-progress", "nav-plan", "nav-weight"].map(shown), [false, false, true, true]);
    if (!shown("tab-plan") || shown("tab-log")) throw new Error("Diet should open the Plan tab");
    assertEqual(doc.querySelector('.section-switch button[data-section="diet"]').getAttribute("aria-pressed"), "true");
    doc.getElementById("nav-weight").click();
    doc.querySelector('.section-switch button[data-section="workout"]').click();
    if (!shown("tab-log")) throw new Error("Workout should open the Log tab again");
    doc.querySelector('.section-switch button[data-section="diet"]').click();
    if (!shown("tab-weight")) throw new Error("switching back to Diet should return to the Weight tab, where you left it");
    assertEqual(savedData(app).section, "diet");
    again = await reopenApp(app);
    if (again.doc.getElementById("tab-plan").classList.contains("hidden") && again.doc.getElementById("tab-weight").classList.contains("hidden")) throw new Error("reopening should land in the Diet section");
    if (app.errors.length) throw new Error(app.errors.join("; "));
  } finally {
    if (again) again.frame.remove();
    closeApp(app);
  }
});

test("the header stays one slim row with the switch in it", async () => {
  const app = await openApp();
  try {
    const row = app.doc.querySelector(".title-row").getBoundingClientRect();
    if (row.height > 60) throw new Error(`the header row is ${Math.round(row.height)}px tall, so something wrapped onto a second line`);
  } finally {
    closeApp(app);
  }
});

test("the Plan tab turns your details and goal into a calorie and protein target", async () => {
  const app = await openApp();
  try {
    const doc = app.doc;
    showTab(app, "plan");
    const target = () => caloriesIn(doc.querySelector("#plan-result .plan-target").textContent);
    const bulk = target();
    if (!/Protein: about \d+ g/.test(doc.getElementById("plan-result").textContent)) throw new Error("the plan should show a protein target");
    setPlanFields(app, { "plan-goal": "maintain" });
    const maintain = target();
    setPlanFields(app, { "plan-goal": "cut" });
    const cut = target();
    if (!(bulk > maintain && maintain > cut)) throw new Error(`bulk ${bulk}, maintain ${maintain} and cut ${cut} should go down in that order`);
    if (!doc.getElementById("plan-result").textContent.includes("fewer calories")) throw new Error("a cut should say how many fewer calories");
    // A faster pace takes more off.
    const steady = target();
    setPlanFields(app, { "plan-pace": "2" });
    if (!(target() < steady)) throw new Error("a faster cut should have a lower target");
    // In pounds mode height is typed as feet and inches, and saved in centimetres.
    setPlanFields(app, { "plan-feet": "5", "plan-inches": "10" });
    if (Math.abs(savedData(app).diet.heightCm - 177.8) > 0.1) throw new Error("5 ft 10 in should be saved as about 177.8 cm");
    assertEqual([doc.getElementById("plan-feet").value, doc.getElementById("plan-inches").value], ["5", "10"]);
    if (doc.getElementById("plan-height").offsetParent !== null) throw new Error("the centimetre box should be hidden in pounds mode");
    // In kilograms mode it is one box in centimetres, filled in with the same height.
    doc.querySelector('.unit-toggle button[data-unit="kg"]').click();
    if (doc.getElementById("plan-feet").offsetParent !== null) throw new Error("the feet box should be hidden in kilograms mode");
    assertEqual(doc.getElementById("plan-height").value, "177.8");
    setPlanFields(app, { "plan-height": "180" });
    assertEqual(savedData(app).diet.heightCm, 180);
    // A height that is not realistic is refused.
    doc.querySelector('.unit-toggle button[data-unit="lb"]').click();
    setPlanFields(app, { "plan-feet": "1", "plan-inches": "0" });
    if (!doc.getElementById("plan-error").textContent) throw new Error("1 ft should be refused as a height");
    assertEqual(savedData(app).diet.heightCm, 180);
    if (app.errors.length) throw new Error(app.errors.join("; "));
  } finally {
    closeApp(app);
  }
});

test("the Plan tab says what is missing, refuses a bad age, and keeps what you enter", async () => {
  const app = await openApp();
  let again;
  try {
    const doc = app.doc;
    showTab(app, "plan");
    setPlanFields(app, { "plan-age": "" });
    if (!doc.getElementById("plan-result").textContent.includes("age")) throw new Error("it should say that the age is missing");
    setPlanFields(app, { "plan-age": "7" });
    if (!doc.getElementById("plan-error").textContent) throw new Error("an age of 7 should be refused with a message");
    assertEqual(savedData(app).diet.age, null);
    setPlanFields(app, { "plan-age": "28", "plan-sex": "female" });
    assertEqual([doc.getElementById("plan-error").textContent, savedData(app).diet.age, savedData(app).sex], ["", 28, "female"]);
    again = await reopenApp(app);
    assertEqual(again.doc.getElementById("plan-age").value, "28");
    app.win.eval("state.bodyweights = []; renderPlan();");
    if (!doc.getElementById("plan-result").textContent.includes("bodyweight")) throw new Error("with no bodyweight logged it should ask for one");
  } finally {
    if (again) again.frame.remove();
    closeApp(app);
  }
});

test("the Weight tab adds a bodyweight that shows on both sides, and its weekly check can adjust the target", async () => {
  const app = await openApp();
  try {
    const doc = app.doc;
    // Three weeks of readings gaining a pound a week; the goal (bulk, steady) is half a pound.
    app.win.eval(`state.bodyweights = [21, 14, 7, 1].map((daysAgo, i) => ({ date: Logic.toDateString(new Date(Date.now() - daysAgo * 86400000)), weight: 180 + i })); renderWeight();`);
    showTab(app, "weight");
    const check = doc.getElementById("diet-check");
    if (!check.textContent.includes("fewer calories") || !check.textContent.includes("250")) throw new Error(`the weekly check reads "${check.textContent}"`);
    showTab(app, "plan");
    const before = caloriesIn(doc.querySelector("#plan-result .plan-target").textContent);
    showTab(app, "weight");
    doc.querySelector("#diet-check button.primary").click();
    assertEqual(savedData(app).diet.adjust, -250);
    showTab(app, "plan");
    assertEqual(caloriesIn(doc.querySelector("#plan-result .plan-target").textContent), before - 250);
    if (!doc.getElementById("plan-result").textContent.includes("Adjusted by")) throw new Error("the plan should say it has been adjusted");
    [...doc.querySelectorAll("#plan-result button")].find((button) => button.textContent.includes("Reset")).click();
    assertEqual([savedData(app).diet.adjust, caloriesIn(doc.querySelector("#plan-result .plan-target").textContent)], [0, before]);
    // Adding today's weight here also puts it in the Progress tab's log.
    showTab(app, "weight");
    doc.getElementById("diet-weight").value = "185";
    fireEvent(doc.getElementById("diet-weight-form"), "submit");
    const todayString = Logic.toDateString(new Date());
    assertEqual(savedData(app).bodyweights.filter((b) => b.date === todayString).map((b) => b.weight), [185]);
    if (app.errors.length) throw new Error(app.errors.join("; "));
  } finally {
    closeApp(app);
  }
});

test("with too few weigh-ins the weekly check says what is needed instead of guessing", async () => {
  const app = await openApp();
  try {
    app.win.eval(`state.bodyweights = [{ date: Logic.toDateString(new Date()), weight: 180 }]; renderWeight();`);
    showTab(app, "weight");
    const text = app.doc.getElementById("diet-check").textContent;
    if (!text.includes("at least 3 times")) throw new Error(`the weekly check reads "${text}"`);
    if (app.doc.querySelector("#diet-check button")) throw new Error("there is nothing to apply yet");
  } finally {
    closeApp(app);
  }
});

test("choosing a backup file offers Merge, which adds only what is new and does nothing the second time", async () => {
  const app = await openApp();
  try {
    const doc = app.doc;
    showTab(app, "history");
    const saved = () => JSON.parse(app.win.localStorage.getItem(app.storage));
    const before = saved();
    const backup = Logic.makeBackup({ ...before, entries: [...before.entries, { id: "from-phone", date: "2026-10-02", exercise: "Squat", weight: 225, reps: 5 }] }, "2026-10-03T08:00:00.000Z");
    const chooseFile = async () => {
      const files = new app.win.DataTransfer();
      files.items.add(new app.win.File([JSON.stringify(backup)], "backup.json", { type: "application/json" }));
      const input = doc.getElementById("backup-file");
      input.files = files.files;
      input.dispatchEvent(new Event("change", { bubbles: true }));
      // Reading the file takes a moment; wait for the panel to appear instead of guessing how long.
      for (let waited = 0; waited < 3000 && doc.getElementById("backup-merge").classList.contains("hidden"); waited += 50) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    };
    await chooseFile();
    const panel = doc.getElementById("backup-merge");
    if (panel.classList.contains("hidden")) throw new Error("choosing a backup should show the Merge panel");
    if (!doc.getElementById("backup-merge-counts").textContent.includes("New sets: 1")) throw new Error(`the panel reads "${doc.getElementById("backup-merge-counts").textContent}"`);
    doc.getElementById("backup-merge-go").click();
    const after = saved();
    if (after.entries.length !== before.entries.length + 1) throw new Error("merging should add exactly the one new set");
    if (!panel.classList.contains("hidden")) throw new Error("the panel should close after merging");
    await chooseFile();
    if (!doc.getElementById("backup-merge-go").disabled) throw new Error("with nothing new, Merge should be disabled");
    if (!doc.getElementById("backup-merge-summary").textContent.includes("already here")) throw new Error("the panel should say everything is already here");
    doc.getElementById("backup-merge-cancel").click();
    if (!panel.classList.contains("hidden") || saved().entries.length !== after.entries.length) throw new Error("Cancel should change nothing");
    if (app.errors.length) throw new Error(app.errors.join("; "));
  } finally {
    closeApp(app);
  }
});

test("a measurement named by the user can be added, measured, renamed and deleted", async () => {
  const app = await openApp();
  try {
    const doc = app.doc;
    app.win.confirm = () => true;
    showTab(app, "progress");
    const fire = (node, type) => node.dispatchEvent(new Event(type, { bubbles: true, cancelable: true }));
    const saved = () => JSON.parse(app.win.localStorage.getItem(app.storage));
    const nameBox = doc.getElementById("measure-custom-name");
    const addCustom = (name) => {
      nameBox.value = name;
      fire(doc.getElementById("measure-custom-form"), "submit");
    };
    addCustom("neck");
    if (!doc.getElementById("measure-custom-error").textContent) throw new Error("copying a built-in name should show an error");
    addCustom("Wrist");
    if (doc.getElementById("measure-name").value !== "Wrist") throw new Error("the new measurement should be chosen in the list");
    doc.getElementById("measure-value").value = "6.5";
    fire(doc.getElementById("measure-form"), "submit");
    const reading = saved().measurements.find((m) => m.name === "Wrist");
    if (!reading || Math.abs(reading.cm - 16.51) > 0.01) throw new Error("the reading should be saved under the new name, in cm");
    // Rename: the reading follows.
    doc.querySelector("#measure-custom-list .routine-card .link").click();
    doc.querySelector("#measure-custom-list form input").value = "Left wrist";
    fire(doc.querySelector("#measure-custom-list form"), "submit");
    const afterRename = saved();
    if (afterRename.customMeasurements[0] !== "Left wrist" || !afterRename.measurements.some((m) => m.name === "Left wrist")) throw new Error("renaming should move the reading to the new name");
    if (doc.getElementById("measure-name").value !== "Left wrist") throw new Error("the renamed measurement should stay chosen");
    // Delete: the name and its reading go.
    [...doc.querySelectorAll("#measure-custom-list .routine-card .link")][1].click();
    const afterDelete = saved();
    if (afterDelete.customMeasurements.length !== 0 || afterDelete.measurements.some((m) => m.name === "Left wrist")) throw new Error("deleting should remove the name and its readings");
    if (app.errors.length) throw new Error(app.errors.join("; "));
  } finally {
    closeApp(app);
  }
});

test("measuring the left and right sides shows how they compare", async () => {
  const app = await openApp();
  try {
    const tab = showTab(app, "progress");
    const doc = app.doc;
    const picker = doc.getElementById("measure-name");
    if ([...picker.options].some((option) => option.value === "Arm")) throw new Error("the old Upper arm should not be offered without readings");
    const add = (name, value) => {
      picker.value = name;
      picker.dispatchEvent(new Event("change", { bubbles: true }));
      doc.getElementById("measure-value").value = value;
      doc.getElementById("measure-form").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    };
    add("LeftArm", "13");
    if (doc.getElementById("measure-compare").textContent !== "") throw new Error("one side alone should not show a comparison");
    add("RightArm", "13.5");
    const text = doc.getElementById("measure-compare").textContent;
    if (!text.includes("right side is 0.5 in bigger")) throw new Error(`the comparison reads "${text}"`);
    if (!tab.querySelector("#measure-chart")) throw new Error("the chart is missing");
    if (app.errors.length) throw new Error(app.errors.join("; "));
  } finally {
    closeApp(app);
  }
});

test("a routine exercise can be swapped for today only, keeps its target, and can be put back", async () => {
  const app = await openApp();
  try {
    const doc = app.doc;
    const fire = (node, type) => node.dispatchEvent(new Event(type, { bubbles: true }));
    const routine = doc.getElementById("routine-select");
    routine.value = "r1";
    fire(routine, "change");
    const chips = () => [...doc.querySelectorAll("#routine-checklist .chip")].map((chip) => chip.textContent);
    const swapRow = doc.getElementById("swap");
    if (!swapRow.classList.contains("hidden")) throw new Error("the Swap row should wait until an exercise is chosen");
    doc.querySelector("#routine-checklist .chip").click();
    if (swapRow.classList.contains("hidden")) throw new Error("choosing a routine exercise should show the Swap row");
    // Squat is not in the Push routine; it takes over Bench Press's slot and its 3-set target.
    const choice = doc.getElementById("swap-select");
    choice.value = "Squat";
    fire(choice, "change");
    if (!chips()[0].includes("Squat") || !chips()[0].includes("⇄") || !chips()[0].includes("/3")) throw new Error(`the first chip reads "${chips()[0]}"`);
    if (doc.getElementById("exercise").value !== "Squat") throw new Error("the form should switch to the new exercise");
    if (!chips()[1].includes("Overhead Press")) throw new Error("the other chips should not change");
    const saved = JSON.parse(app.win.localStorage.getItem(app.storage));
    if (JSON.stringify(Object.values(saved.routineSwaps)[0]) !== '{"r1":{"0":"Squat"}}') throw new Error("the swap should be saved for today");
    if (JSON.stringify(saved.routines[0].exercises) !== '["Bench Press","Overhead Press"]') throw new Error("the routine itself must not change");
    // Putting it back.
    doc.getElementById("swap-undo").click();
    if (chips()[0].includes("Squat") || !chips()[0].includes("Bench Press")) throw new Error(`after undo the first chip reads "${chips()[0]}"`);
    if (Object.keys(JSON.parse(app.win.localStorage.getItem(app.storage)).routineSwaps).length !== 0) throw new Error("undoing should leave no swap saved");
    if (app.errors.length) throw new Error(app.errors.join("; "));
  } finally {
    closeApp(app);
  }
});

test("warm-up sets can be logged from the Log tab and never count as a record", async () => {
  const app = await openApp();
  try {
    const exerciseBox = app.doc.getElementById("exercise");
    exerciseBox.value = "Bench Press";
    exerciseBox.dispatchEvent(new Event("input", { bubbles: true }));
    const weight = app.doc.getElementById("weight");
    weight.value = "400";
    weight.dispatchEvent(new Event("input", { bubbles: true }));
    const summary = app.doc.getElementById("warmup-summary").textContent;
    if (!summary.startsWith("Warm-up: 45×10")) throw new Error(`the warm-up summary reads "${summary}"`);
    const buttons = () => [...app.doc.querySelectorAll("#warmup-list button")];
    if (buttons().length < 3) throw new Error("expected a Log button for each warm-up set");
    // The heaviest warm-up is far above the 140 lb best in the sample data, so it would be a record if it counted.
    buttons()[buttons().length - 1].click();
    if (!app.doc.getElementById("today-list").textContent.includes("Warm-up 1")) throw new Error("the logged set should show as Warm-up 1");
    if (!buttons()[buttons().length - 1].disabled) throw new Error("a logged warm-up's button should be disabled");
    if (app.doc.querySelector("#toast.record")) throw new Error("a warm-up must not give a New record message");
    const tab = showTab(app, "progress");
    const bench = [...tab.querySelectorAll("#records-list .record-row")].find((row) => row.textContent.includes("Bench Press"));
    if (!bench || !bench.textContent.includes("140 lb")) throw new Error(`the Bench Press record should still be 140 lb, but reads "${bench && bench.textContent}"`);
    if (app.errors.length) throw new Error(app.errors.join("; "));
  } finally {
    closeApp(app);
  }
});

test("typing a weight shows which plates to load on each side, in lb and kg, and remembers the bar", async () => {
  const app = await openApp();
  try {
    const weight = app.doc.getElementById("weight");
    const type = (value) => {
      weight.value = value;
      weight.dispatchEvent(new Event("input", { bubbles: true }));
    };
    const summary = () => app.doc.getElementById("plates-summary").textContent;
    const exerciseBox = app.doc.getElementById("exercise");
    exerciseBox.value = "Bench Press";
    exerciseBox.dispatchEvent(new Event("input", { bubbles: true }));
    assertEqual(summary(), "Plate calculator");
    type("185");
    assertEqual(summary(), "Plates: 45 + 25 each side");
    app.doc.getElementById("plates").open = true;
    const detail = app.doc.getElementById("plates-detail").textContent;
    if (!detail.includes("Bar 45 lb") || !detail.includes("= 185 lb")) throw new Error(`the detail should show the bar and the total, but reads "${detail}"`);
    type("186");
    assertEqual(summary(), "Closest 185 lb: 45 + 25 each side");
    type("30");
    if (!summary().includes("Lighter than the bar (45 lb)")) throw new Error(`reads "${summary()}"`);
    type("45");
    assertEqual(summary(), "Just the bar");
    type("");
    assertEqual(summary(), "Plate calculator");
    // In kilograms the bar and the plates change with the unit.
    app.doc.querySelector('.unit-toggle button[data-unit="kg"]').click();
    type("100");
    assertEqual(summary(), "Plates: 25 + 15 each side");
    // A lighter bar changes the answer, and the choice is saved for next time.
    const bar = app.doc.getElementById("bar-select");
    bar.value = "15";
    bar.dispatchEvent(new Event("change", { bubbles: true }));
    assertEqual(summary(), "Plates: 25 + 15 + 2.5 each side");
    assertEqual(JSON.parse(localStorage.getItem(app.storage)).barWeight, { lb: 45, kg: 15 });
    if (app.errors.length) throw new Error(`the app raised errors: ${app.errors.join("; ")}`);
  } finally {
    closeApp(app);
  }
});

test("an exercise note is added under the chosen exercise, shown at a glance, and kept for that exercise only", async () => {
  const app = await openApp();
  try {
    const choose = (name) => {
      const box = app.doc.getElementById("exercise");
      box.value = name;
      box.dispatchEvent(new Event("input", { bubbles: true }));
    };
    const row = app.doc.getElementById("exercise-note");
    const summary = () => app.doc.getElementById("exercise-note-summary").textContent;
    if (!row.classList.contains("hidden")) throw new Error("with no exercise chosen there is nothing to attach a note to");
    choose("Bench Press");
    assertEqual([row.classList.contains("hidden"), summary()], [false, "Add a note"]);
    const text = app.doc.getElementById("exercise-note-text");
    text.value = "  Wide grip,\nseat at 3  ";
    text.dispatchEvent(new Event("change", { bubbles: true }));
    assertEqual(summary(), "Note: Wide grip, seat at 3");
    assertEqual(JSON.parse(localStorage.getItem(app.storage)).exerciseNotes, { "Bench Press": "Wide grip,\nseat at 3" });
    choose("Squat");
    assertEqual(summary(), "Add a note");
    choose("Bench Press");
    assertEqual([summary(), text.value], ["Note: Wide grip, seat at 3", "Wide grip,\nseat at 3"]);
    text.value = "";
    text.dispatchEvent(new Event("change", { bubbles: true }));
    assertEqual([summary(), JSON.parse(localStorage.getItem(app.storage)).exerciseNotes], ["Add a note", {}]);
    if (app.errors.length) throw new Error(`the app raised errors: ${app.errors.join("; ")}`);
  } finally {
    closeApp(app);
  }
});

test("the plate calculator shows only for barbell exercises, and a new exercise opts in with a checkbox", async () => {
  const app = await openApp();
  try {
    const choose = (name) => {
      const box = app.doc.getElementById("exercise");
      box.value = name;
      box.dispatchEvent(new Event("input", { bubbles: true }));
    };
    const shown = () => !app.doc.getElementById("plates").classList.contains("hidden");
    assertEqual(shown(), false);
    const results = {};
    for (const name of ["Bench Press", "Incline Dumbbell Press", "Squat", "Lat Pulldown", "Bicep Curl", "Leg Press", "Deadlift"]) {
      choose(name);
      results[name] = shown();
    }
    assertEqual(results, { "Bench Press": true, "Incline Dumbbell Press": false, "Squat": true, "Lat Pulldown": false, "Bicep Curl": false, "Leg Press": false, "Deadlift": true });
    // A new exercise: no plates until the box is ticked.
    choose("Landmine Press");
    assertEqual(app.doc.getElementById("muscle-row").classList.contains("hidden"), false);
    const box = app.doc.getElementById("barbell-check");
    assertEqual(shown(), false);
    box.checked = true;
    box.dispatchEvent(new Event("change", { bubbles: true }));
    assertEqual(shown(), true);
    box.checked = false;
    box.dispatchEvent(new Event("change", { bubbles: true }));
    assertEqual(shown(), false);
    box.checked = true;
    box.dispatchEvent(new Event("change", { bubbles: true }));
    logSetInApp(app, "Landmine Press", 60, 8);
    assertEqual([JSON.parse(localStorage.getItem(app.storage)).barbellExercises, box.checked, shown()], [{ "Landmine Press": true }, false, true]);
    choose("Bicep Curl");
    assertEqual(shown(), false);
    choose("Landmine Press");
    assertEqual(shown(), true);
    // Editing it in My exercises: the card says Barbell, and unticking the box takes the plates away.
    const routines = showTab(app, "routines");
    const card = [...routines.querySelectorAll("#my-exercises .routine-card")].find((node) => node.textContent.includes("Landmine Press"));
    if (!card.textContent.includes("Barbell")) throw new Error(`the card should say Barbell, but reads "${card.textContent}"`);
    card.querySelector("button.link").click();
    const form = routines.querySelector("#my-exercises form");
    const checkbox = form.querySelector('input[type="checkbox"]');
    assertEqual(checkbox.checked, true);
    checkbox.checked = false;
    form.requestSubmit();
    assertEqual(JSON.parse(localStorage.getItem(app.storage)).barbellExercises, {});
    showTab(app, "log");
    choose("Landmine Press");
    assertEqual(shown(), false);
    if (app.errors.length) throw new Error(`the app raised errors: ${app.errors.join("; ")}`);
  } finally {
    closeApp(app);
  }
});

test("opening the gear shows an offline status that settles on one of the three messages", async () => {
  const app = await openApp();
  try {
    const messages = ["ready", "notReady", "unavailable"].map((name) => registeredLanguages.en.strings[`offlineStatus.${name}`]);
    const status = app.doc.getElementById("offline-status");
    app.doc.getElementById("display-toggle").click();
    for (let waited = 0; waited < 2000 && !messages.includes(status.textContent); waited += 50) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    if (!messages.includes(status.textContent)) throw new Error(`the status never settled, and reads "${status.textContent}"`);
    if (app.errors.length) throw new Error(`the app raised errors: ${app.errors.join("; ")}`);
  } finally {
    closeApp(app);
  }
});

test("the gear in the header opens and closes the display settings", async () => {
  const app = await openApp();
  try {
    const gear = app.doc.getElementById("display-toggle");
    const panel = app.doc.getElementById("display-panel");
    assertEqual([panel.classList.contains("hidden"), gear.getAttribute("aria-expanded")], [true, "false"]);
    gear.click();
    assertEqual([panel.classList.contains("hidden"), gear.getAttribute("aria-expanded")], [false, "true"]);
    gear.click();
    assertEqual([panel.classList.contains("hidden"), gear.getAttribute("aria-expanded")], [true, "false"]);
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
    app.doc.getElementById("display-panel").classList.remove("hidden"); // so its text is read too
    // Open a routine for editing, so its target boxes and their labels are on screen too.
    showTab(app, "routines");
    app.doc.querySelector("#routine-list .routine-card button.link").click();
    for (const code of Object.keys(registeredLanguages)) {
      select.value = code;
      select.dispatchEvent(new Event("change", { bubbles: true }));
      for (const name of TAB_NAMES) {
        const tab = showTab(app, name);
        // Closed sections hide their text, so open every one before reading the screen.
        for (const details of tab.querySelectorAll("details")) details.open = true;
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
