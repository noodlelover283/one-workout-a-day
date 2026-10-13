// Pure data logic for One Workout a Day. No DOM access here, so it is easy to test.
const Logic = (() => {
  const MUSCLE_GROUPS = ["Chest", "Back", "Legs", "Shoulders", "Arms", "Core"];

  const DEFAULT_EXERCISES = {
    "Bench Press": "Chest",
    "Incline Dumbbell Press": "Chest",
    "Deadlift": "Back",
    "Barbell Row": "Back",
    "Lat Pulldown": "Back",
    "Pull-Up": "Back",
    "Squat": "Legs",
    "Leg Press": "Legs",
    "Romanian Deadlift": "Legs",
    "Overhead Press": "Shoulders",
    "Lateral Raise": "Shoulders",
    "Bicep Curl": "Arms",
    "Tricep Pushdown": "Arms",
    "Plank (weighted)": "Core",
  };

  const STALL_DAYS = 21;
  const MIN_SESSIONS_TO_JUDGE = 3;
  const DEFAULT_REP_GOAL = 8;

  const THEMES = ["auto", "light", "dark", "contrast"];
  const TEXT_SIZES = [100, 125, 150, 175]; // percent of the normal size
  const DEFAULT_APPEARANCE = { theme: "auto", textSize: 100 };

  // Keeps only valid saved display settings, falling back to the defaults.
  function sanitizeAppearance(saved) {
    const appearance = { ...DEFAULT_APPEARANCE };
    if (saved && THEMES.includes(saved.theme)) appearance.theme = saved.theme;
    if (saved && TEXT_SIZES.includes(saved.textSize)) appearance.textSize = saved.textSize;
    return appearance;
  }

  // "auto" follows the device; the other themes are used as chosen.
  function resolveTheme(theme, deviceIsDark) {
    if (theme === "auto") return deviceIsDark ? "dark" : "light";
    return theme;
  }

  // Typical jump between workouts, per muscle group, in each unit. Lower-body lifts go up in bigger
  // steps than upper-body lifts, and small isolation work goes up least. Kept per unit so the
  // numbers match real plate sizes (5 lb / 2.5 kg) instead of awkward conversions.
  const DEFAULT_WEIGHT_JUMPS = {
    lb: { Legs: 10, Back: 5, Chest: 5, Shoulders: 2.5, Arms: 2.5, Core: 2.5 },
    kg: { Legs: 5, Back: 2.5, Chest: 2.5, Shoulders: 1.25, Arms: 1.25, Core: 1.25 },
  };
  const DAY_MS = 24 * 60 * 60 * 1000;

  const LB_PER_KG = 2.20462262;

  // Weights are always stored in pounds; these convert for display and input.
  function fromLb(pounds, unit) {
    return unit === "kg" ? pounds / LB_PER_KG : pounds;
  }

  function toLb(value, unit) {
    return unit === "kg" ? value * LB_PER_KG : value;
  }

  // A weight in pounds as text in the chosen unit, with at most one decimal, e.g. "61.2".
  function formatWeight(pounds, unit) {
    return String(Math.round(fromLb(pounds, unit) * 10) / 10);
  }

  function toDateString(date) {
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${date.getFullYear()}-${month}-${day}`;
  }

  function daysBetween(earlier, later) {
    const toUtc = (s) => {
      const [y, m, d] = s.split("-").map(Number);
      return Date.UTC(y, m - 1, d);
    };
    return Math.round((toUtc(later) - toUtc(earlier)) / DAY_MS);
  }

  function normalizeName(name) {
    return name.trim().replace(/\s+/g, " ");
  }

  function findKnownExercise(name, customExercises) {
    const lower = normalizeName(name).toLowerCase();
    const all = { ...DEFAULT_EXERCISES, ...customExercises };
    return Object.keys(all).find((known) => known.toLowerCase() === lower) || null;
  }

  // Renaming a custom exercise (and optionally changing its muscle group) has to update everything
  // that uses the name. If the new name is another exercise that already exists (a typo fixed into a
  // real name, say), the two are merged: the sets move over and the existing exercise keeps its group.
  // `data` is { entries, routines, customExercises }; a new copy is returned with the final name.
  function renameExercise({ entries, routines, customExercises }, from, to, group) {
    const clean = normalizeName(to);
    const existing = findKnownExercise(clean, customExercises);
    const merging = existing !== null && existing !== from;
    const newName = merging ? existing : clean;
    const custom = { ...customExercises };
    delete custom[from];
    if (!merging) custom[newName] = group;
    return {
      entries: entries.map((entry) => (entry.exercise === from ? { ...entry, exercise: newName } : entry)),
      routines: routines.map((routine) => {
        if (!routine.exercises.includes(from)) return routine;
        const renamed = routine.exercises.map((name) => (name === from ? newName : name));
        // After a merge a routine may now list the same exercise twice; keep the first.
        const exercises = merging ? renamed.filter((name, index) => name !== newName || renamed.indexOf(name) === index) : renamed;
        return { ...routine, exercises };
      }),
      customExercises: custom,
      newName,
      merging,
    };
  }

  // Removes a custom exercise, its logged sets, and its place in any routine.
  function deleteExercise({ entries, routines, customExercises }, name) {
    const custom = { ...customExercises };
    delete custom[name];
    return {
      entries: entries.filter((entry) => entry.exercise !== name),
      routines: routines.map((routine) => ({ ...routine, exercises: routine.exercises.filter((exercise) => exercise !== name) })),
      customExercises: custom,
    };
  }

  // How much would be affected by renaming or deleting an exercise.
  function exerciseUsage({ entries, routines }, name) {
    return {
      sets: entries.filter((entry) => entry.exercise === name).length,
      routines: routines.filter((routine) => routine.exercises.includes(name)).length,
    };
  }

  // The validate functions return the key of an error message (see lang-en.js), or "" if the input is fine.
  function validateEntry({ exercise, weight, reps }) {
    if (!normalizeName(exercise)) return "error.exerciseName";
    if (!(weight >= 0) || Number.isNaN(weight)) return "error.weight";
    if (!Number.isInteger(reps) || reps < 1 || reps > 100) return "error.reps";
    return "";
  }

  // Each entry is one set. Older saves stored "3 sets of 8" as a single entry; split those up.
  function migrateEntries(entries) {
    return entries.flatMap((entry) => {
      if (entry.sets === undefined) return [entry];
      const { sets, ...rest } = entry;
      return Array.from({ length: sets }, (_, index) => ({ ...rest, id: `${entry.id}-${index + 1}` }));
    });
  }

  // Changes one set's exercise, weight and reps. If the exercise name is one we already know (any
  // letter case) the set moves to it; if it is new, a custom exercise is created in `group`. A custom
  // exercise left with no sets and no routine (a typo that has just been corrected) is dropped.
  // `data` is { entries, routines, customExercises }; returns new entries and customExercises.
  function updateSetDetails({ entries, routines, customExercises }, id, { exercise, weight, reps }, group) {
    const old = entries.find((entry) => entry.id === id).exercise;
    const known = findKnownExercise(exercise, customExercises);
    const name = known || normalizeName(exercise);
    const updated = entries.map((entry) => (entry.id === id ? { ...entry, exercise: name, weight, reps } : entry));
    const custom = { ...customExercises };
    if (!known) custom[name] = group;
    const stillUsed = updated.some((entry) => entry.exercise === old) || routines.some((routine) => routine.exercises.includes(old));
    if (old !== name && custom[old] !== undefined && !stillUsed) delete custom[old];
    return { entries: updated, customExercises: custom, exercise: name, moved: name !== old };
  }

  // Groups sets by exercise, in the order each exercise first appears.
  function groupByExercise(entries) {
    const groups = [];
    for (const entry of entries) {
      let group = groups.find((g) => g.exercise === entry.exercise);
      if (!group) {
        group = { exercise: entry.exercise, sets: [] };
        groups.push(group);
      }
      group.sets.push(entry);
    }
    return groups;
  }

  function validateStallDays(days) {
    if (!Number.isInteger(days) || days < 1 || days > 365) return "error.stallDays";
    return "";
  }

  const MIN_REST_SECONDS = 5;
  const MAX_REST_SECONDS = 3600;

  function validateRestSeconds(seconds) {
    if (!Number.isInteger(seconds) || seconds < MIN_REST_SECONDS || seconds > MAX_REST_SECONDS) {
      return "error.restSeconds";
    }
    return "";
  }

  // 90 -> "1:30", 5 -> "0:05"
  function formatClock(totalSeconds) {
    const seconds = Math.max(0, Math.ceil(totalSeconds));
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
  }

  function validateRepGoal(reps) {
    if (!Number.isInteger(reps) || reps < 1 || reps > 30) return "error.repGoal";
    return "";
  }

  function validateWeightJump(jump) {
    if (!(jump > 0) || jump > 100) return "error.weightJump";
    return "";
  }

  // Suggests the next weight for an exercise from its most recent session (given entries must
  // all be from before today's session). If every set at the heaviest weight reached the rep goal,
  // go up by jumpLb; otherwise repeat the weight and aim for one more rep. Returns null if the
  // exercise has never been done.
  function suggestNext(entries, exercise, repGoal, jumpLb) {
    const last = lastSet(entries, exercise);
    if (!last) return null;
    const session = entries.filter((e) => e.exercise === exercise && e.date === last.date);
    const topWeight = Math.max(...session.map((e) => e.weight));
    const topSets = session.filter((e) => e.weight === topWeight);
    const fewestReps = Math.min(...topSets.map((e) => e.reps));
    const hitGoal = fewestReps >= repGoal;
    return {
      weight: hitGoal ? topWeight + jumpLb : topWeight,
      reps: hitGoal ? repGoal : Math.min(repGoal, fewestReps + 1),
      increased: hitGoal,
      sessionDate: last.date,
      session,
    };
  }

  // The most recently logged set of an exercise (latest date, then latest added), or null.
  function lastSet(entries, exercise) {
    let latest = null;
    for (const entry of entries) {
      if (entry.exercise === exercise && (!latest || entry.date >= latest.date)) latest = entry;
    }
    return latest;
  }

  function validateRoutine({ name, exercises }) {
    if (!normalizeName(name)) return "error.routineName";
    if (exercises.length === 0) return "error.routineExercises";
    return "";
  }

  // For each exercise, the dates on which it set a new weight record.
  // The heaviest weight logged so far for an exercise, or null if it has never been logged.
  function bestWeight(entries, exercise) {
    const weights = entries.filter((e) => e.exercise === exercise).map((e) => e.weight);
    return weights.length ? Math.max(...weights) : null;
  }

  // A new set is a record when it beats the best weight already logged. The very first set of an
  // exercise is not called a record, since there is nothing to beat yet.
  function isNewRecord(previousBest, weight) {
    return previousBest !== null && weight > previousBest;
  }

  function recordDates(entries) {
    const sorted = [...entries].sort((a, b) => a.date.localeCompare(b.date));
    const best = {};
    const records = {};
    for (const entry of sorted) {
      if (best[entry.exercise] === undefined || entry.weight > best[entry.exercise]) {
        best[entry.exercise] = entry.weight;
        records[entry.exercise] = entry.date;
      }
    }
    return records;
  }

  // One status per muscle group that has been trained at least once.
  function plateauStatus(entries, muscleOf, today, stallDaysOf = () => STALL_DAYS) {
    const records = recordDates(entries);
    const groups = {};
    for (const entry of entries) {
      const group = muscleOf(entry.exercise);
      if (!group) continue;
      const info = groups[group] || (groups[group] = { group, lastTrained: "", lastRecord: "", days: new Set() });
      if (entry.date > info.lastTrained) info.lastTrained = entry.date;
      info.days.add(entry.date);
    }
    for (const exercise of Object.keys(records)) {
      const info = groups[muscleOf(exercise)];
      if (info && records[exercise] > info.lastRecord) info.lastRecord = records[exercise];
    }
    return Object.values(groups)
      .map((info) => {
        const sinceRecord = daysBetween(info.lastRecord, today);
        const sinceTrained = daysBetween(info.lastTrained, today);
        let state = "progressing";
        if (info.days.size < MIN_SESSIONS_TO_JUDGE) state = "new";
        else if (sinceRecord >= stallDaysOf(info.group)) state = "stalled";
        return { group: info.group, state, sinceRecord, sinceTrained, sessions: info.days.size, stallDays: stallDaysOf(info.group) };
      })
      .sort((a, b) => b.sinceRecord - a.sinceRecord);
  }

  // The estimate gets unreliable for long sets, so sets above this many reps are left out.
  const ONE_REP_MAX_MAX_REPS = 12;

  // Epley formula: the weight you could lift once, estimated from a set. A single rep is the weight itself.
  function estimateOneRepMax(weight, reps) {
    return reps === 1 ? weight : weight * (1 + reps / 30);
  }

  // Sets that can give an estimate: some weight on the bar and 1 to 12 reps.
  const canEstimate = (entry) => entry.weight > 0 && entry.reps >= 1 && entry.reps <= ONE_REP_MAX_MAX_REPS;

  // Best estimated one-rep max per date for one exercise, oldest first.
  function oneRepMaxSeries(entries, exercise) {
    const byDate = {};
    for (const entry of entries) {
      if (entry.exercise !== exercise || !canEstimate(entry)) continue;
      byDate[entry.date] = Math.max(byDate[entry.date] || 0, estimateOneRepMax(entry.weight, entry.reps));
    }
    return Object.keys(byDate)
      .sort()
      .map((date) => ({ date, value: byDate[date] }));
  }

  // The set behind the highest estimate ever for an exercise, or null if no set can give one.
  function bestOneRepMax(entries, exercise) {
    let best = null;
    for (const entry of entries) {
      if (entry.exercise !== exercise || !canEstimate(entry)) continue;
      const value = estimateOneRepMax(entry.weight, entry.reps);
      if (!best || value > best.value) best = { value, weight: entry.weight, reps: entry.reps, date: entry.date };
    }
    return best;
  }

  // Heaviest weight per date for one exercise, oldest first.
  function exerciseSeries(entries, exercise) {
    const byDate = {};
    for (const entry of entries) {
      if (entry.exercise !== exercise) continue;
      byDate[entry.date] = Math.max(byDate[entry.date] || 0, entry.weight);
    }
    return Object.keys(byDate)
      .sort()
      .map((date) => ({ date, value: byDate[date] }));
  }

  function sampleData(today) {
    const entries = [];
    const now = new Date(today + "T00:00:00");
    const dayString = (daysAgo) => {
      const d = new Date(now);
      d.setDate(d.getDate() - daysAgo);
      return toDateString(d);
    };
    const add = (daysAgo, exercise, weight, sets, reps) => {
      for (let i = 0; i < sets; i++) {
        entries.push({ id: `sample-${entries.length}`, date: dayString(daysAgo), exercise, weight, reps });
      }
    };
    // Bench keeps climbing; squat stalled five weeks ago.
    [[49, 115], [42, 120], [35, 125], [28, 125], [21, 130], [14, 135], [7, 135], [2, 140]].forEach(
      ([ago, w]) => add(ago, "Bench Press", w, 3, 8)
    );
    [[56, 185], [49, 195], [42, 205], [35, 205], [28, 205], [21, 205], [14, 205], [5, 205]].forEach(
      ([ago, w]) => add(ago, "Squat", w, 3, 6)
    );
    [[45, 25], [31, 30], [17, 30], [3, 35]].forEach(([ago, w]) => add(ago, "Bicep Curl", w, 3, 10));
    const bodyweights = [[56, 172.0], [42, 173.5], [28, 174.2], [14, 175.8], [1, 176.5]].map(([ago, w]) => ({
      date: dayString(ago),
      weight: w,
    }));
    return { entries, bodyweights };
  }

  // One well-reviewed tutorial video (a YouTube video id) for each built-in exercise.
  const DEMO_VIDEOS = {
    "Bench Press": "4Y2ZdHCOXok",
    "Incline Dumbbell Press": "IP4oeKh1Sd4",
    "Deadlift": "XxWcirHIwVo",
    "Barbell Row": "FWJR5Ve8bnQ",
    "Lat Pulldown": "SALxEARiMkw",
    "Pull-Up": "XB_7En-zf_M",
    "Squat": "gcNh17Ckjgg",
    "Leg Press": "K5n2vg3oZa4",
    "Romanian Deadlift": "3VXmecChYYM",
    "Overhead Press": "KP1sYz2VICk",
    "Lateral Raise": "PzsMitRdI_8",
    "Bicep Curl": "ykJmrZ5v0Oo",
    "Tricep Pushdown": "-zLyUAo1gMw",
    "Plank (weighted)": "LDK-UG8XZfM",
  };

  // Built-in exercises open their tutorial video; any other exercise opens a YouTube search for it.
  function demoUrl(exercise) {
    if (Object.prototype.hasOwnProperty.call(DEMO_VIDEOS, exercise)) {
      return `https://www.youtube.com/watch?v=${DEMO_VIDEOS[exercise]}`;
    }
    return `https://www.youtube.com/results?search_query=${encodeURIComponent(`${normalizeName(exercise)} proper form`)}`;
  }

  // The date strings for every day of a month (month 0 = January), laid out in weeks that start on
  // weekStart (0 = Sunday ... 6 = Saturday). Days that belong to the neighbouring months are null.
  function monthCells(year, month, weekStart) {
    const leading = (new Date(year, month, 1).getDay() - weekStart + 7) % 7;
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const cells = Array(leading).fill(null);
    for (let day = 1; day <= daysInMonth; day++) cells.push(toDateString(new Date(year, month, day)));
    while (cells.length % 7 !== 0) cells.push(null);
    return cells;
  }

  // The date a calendar week starts on (weekStart: 0 = Sunday ... 6 = Saturday) for any date in it.
  function weekStartOf(dateString, weekStart) {
    const [year, month, day] = dateString.split("-").map(Number);
    const daysIntoWeek = (new Date(year, month - 1, day).getDay() - weekStart + 7) % 7;
    return toDateString(new Date(year, month - 1, day - daysIntoWeek));
  }

  // Weeks in a row with at least one workout, counting back from this week. A week that has not had a
  // workout yet does not break the streak, so it only ends once a whole week has passed without one.
  function currentWeeklyStreak(workoutDates, today, weekStart) {
    const weeks = new Set([...workoutDates].map((date) => weekStartOf(date, weekStart)));
    const weekBefore = (weekStartDate) => {
      const [year, month, day] = weekStartDate.split("-").map(Number);
      return toDateString(new Date(year, month - 1, day - 7));
    };
    let week = weekStartOf(today, weekStart);
    if (!weeks.has(week)) week = weekBefore(week);
    let streak = 0;
    while (weeks.has(week)) {
      streak += 1;
      week = weekBefore(week);
    }
    return streak;
  }

  // Rough strength levels from the best estimated one-rep max divided by bodyweight. The ratios are
  // our own rounded approximations (not a copy of any published table), set to sit near the typical
  // ratios in public gym-goer data for a 75 kg man and a 65 kg woman. Heavier and lighter lifters
  // are compared less accurately, so the app calls this a rough guide. Thresholds for Beginner,
  // Novice, Intermediate, Advanced and Elite, in that order.
  const STRENGTH_LEVELS = ["Beginner", "Novice", "Intermediate", "Advanced", "Elite"];
  const STRENGTH_STANDARDS = {
    male: {
      "Bench Press": [0.65, 0.9, 1.1, 1.35, 1.8],
      "Squat": [0.7, 1.1, 1.4, 1.7, 2.25],
      "Deadlift": [0.9, 1.4, 1.8, 2.2, 2.7],
      "Overhead Press": [0.4, 0.55, 0.7, 0.8, 1.0],
    },
    female: {
      "Bench Press": [0.35, 0.5, 0.65, 0.85, 1.2],
      "Squat": [0.4, 0.75, 1.05, 1.35, 1.9],
      "Deadlift": [0.6, 1.0, 1.3, 1.65, 2.15],
      "Overhead Press": [0.25, 0.35, 0.45, 0.55, 0.7],
    },
  };
  const STRENGTH_LIFTS = Object.keys(STRENGTH_STANDARDS.male);
  const STRENGTH_SEXES = Object.keys(STRENGTH_STANDARDS);

  // How a lift compares: the ratio to bodyweight, the highest level reached (an index into
  // STRENGTH_LEVELS, or -1 if below Beginner) and the next level with the weight needed to reach it.
  // Returns null when there is no standard for this sex and lift, or no bodyweight.
  function strengthLevel(sex, exercise, oneRepMax, bodyweight) {
    const thresholds = STRENGTH_STANDARDS[sex] && STRENGTH_STANDARDS[sex][exercise];
    if (!thresholds || !(bodyweight > 0)) return null;
    const ratio = oneRepMax / bodyweight;
    const reached = thresholds.filter((minimum) => ratio >= minimum).length - 1;
    const next = reached + 1 < thresholds.length ? { level: STRENGTH_LEVELS[reached + 1], weight: thresholds[reached + 1] * bodyweight } : null;
    return { ratio, reached, level: reached >= 0 ? STRENGTH_LEVELS[reached] : null, next };
  }

  // The most recent bodyweight in pounds, or null if none was logged.
  function latestBodyweight(bodyweights) {
    if (bodyweights.length === 0) return null;
    return [...bodyweights].sort((a, b) => b.date.localeCompare(a.date))[0].weight;
  }

  // Body measurements are stored in centimetres: [{ date, name, cm }], one per day and name.
  const MEASUREMENTS = ["Neck", "Chest", "Waist", "Hips", "Arm", "Thigh"];
  const CM_PER_INCH = 2.54;
  const MAX_MEASUREMENT_CM = 300;

  // Lengths follow the weight toggle: pounds go with inches, kilograms with centimetres.
  const lengthUnitFor = (weightUnit) => (weightUnit === "kg" ? "cm" : "in");
  const lengthToCm = (value, weightUnit) => (weightUnit === "kg" ? value : value * CM_PER_INCH);
  const cmToLength = (cm, weightUnit) => (weightUnit === "kg" ? cm : cm / CM_PER_INCH);

  // A length in the chosen unit as text with at most one decimal, e.g. "81.3".
  function formatLength(cm, weightUnit) {
    return String(Math.round(cmToLength(cm, weightUnit) * 10) / 10);
  }

  function validateMeasurement(cm) {
    return cm > 0 && cm <= MAX_MEASUREMENT_CM ? "" : "error.measurement";
  }

  // A copy of the measurements with this one added, replacing any for the same day and name.
  function setMeasurement(measurements, { date, name, cm }) {
    return [...measurements.filter((m) => !(m.date === date && m.name === name)), { date, name, cm }];
  }

  // One measurement over time, oldest first.
  function measurementSeries(measurements, name) {
    return measurements
      .filter((m) => m.name === name)
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((m) => ({ date: m.date, value: m.cm }));
  }

  // Keeps only valid saved measurements.
  function sanitizeMeasurements(saved) {
    if (!Array.isArray(saved)) return [];
    return saved.filter(
      (m) => m && MEASUREMENTS.includes(m.name) && DATE_PATTERN.test(m.date) && typeof m.cm === "number" && validateMeasurement(m.cm) === "",
    );
  }

  const NOTE_MAX_LENGTH = 1000;

  // Notes are kept as { "2026-10-11": "text" }, one per day. An empty note removes that day's note.
  function setNote(notes, date, text) {
    const clean = text.trim().slice(0, NOTE_MAX_LENGTH);
    const updated = { ...notes };
    if (clean) updated[date] = clean;
    else delete updated[date];
    return updated;
  }

  // Keeps only valid saved notes: a real date, with some text.
  function sanitizeNotes(saved) {
    const notes = {};
    if (!saved || typeof saved !== "object") return notes;
    for (const [date, text] of Object.entries(saved)) {
      if (DATE_PATTERN.test(date) && typeof text === "string" && text.trim()) notes[date] = text.trim().slice(0, NOTE_MAX_LENGTH);
    }
    return notes;
  }

  const BACKUP_APP = "one-workout-a-day";
  const BACKUP_VERSION = 1;
  const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

  // Wraps the saved data in a labelled file so a restore can tell it is really one of ours.
  function makeBackup(data, exportedAt) {
    return { app: BACKUP_APP, version: BACKUP_VERSION, exportedAt, data };
  }

  // Reads the text of a backup file. Returns { data, exportedAt } or { error } with a message key.
  // Only the workouts and bodyweights are checked closely; the rest is cleaned up when it is loaded.
  function parseBackup(text) {
    let backup;
    try {
      backup = JSON.parse(text);
    } catch (error) {
      return { error: "error.backupFile" };
    }
    if (!backup || backup.app !== BACKUP_APP || !backup.data) return { error: "error.backupFile" };
    if (backup.version > BACKUP_VERSION) return { error: "error.backupNewer" };
    const { entries, bodyweights } = backup.data;
    if (!Array.isArray(entries) || !Array.isArray(bodyweights)) return { error: "error.backupFile" };
    const entriesOk = entries.every(
      (e) => e && typeof e.exercise === "string" && DATE_PATTERN.test(e.date) && typeof e.weight === "number" && validateEntry(e) === "",
    );
    const bodyweightsOk = bodyweights.every((b) => b && DATE_PATTERN.test(b.date) && b.weight > 0);
    if (!entriesOk || !bodyweightsOk) return { error: "error.backupFile" };
    return { data: backup.data, exportedAt: backup.exportedAt };
  }

  return {
    STRENGTH_LEVELS,
    STRENGTH_LIFTS,
    STRENGTH_SEXES,
    STRENGTH_STANDARDS,
    strengthLevel,
    latestBodyweight,
    MEASUREMENTS,
    lengthUnitFor,
    lengthToCm,
    formatLength,
    validateMeasurement,
    setMeasurement,
    measurementSeries,
    sanitizeMeasurements,
    monthCells,
    weekStartOf,
    currentWeeklyStreak,
    NOTE_MAX_LENGTH,
    setNote,
    sanitizeNotes,
    MUSCLE_GROUPS,
    DEFAULT_EXERCISES,
    STALL_DAYS,
    MIN_SESSIONS_TO_JUDGE,
    demoUrl,
    makeBackup,
    parseBackup,
    fromLb,
    toLb,
    formatWeight,
    toDateString,
    daysBetween,
    normalizeName,
    findKnownExercise,
    renameExercise,
    deleteExercise,
    exerciseUsage,
    validateEntry,
    validateStallDays,
    migrateEntries,
    updateSetDetails,
    groupByExercise,
    lastSet,
    validateRoutine,
    validateRestSeconds,
    MIN_REST_SECONDS,
    MAX_REST_SECONDS,
    formatClock,
    validateRepGoal,
    validateWeightJump,
    suggestNext,
    DEFAULT_REP_GOAL,
    DEFAULT_WEIGHT_JUMPS,
    DEFAULT_APPEARANCE,
    sanitizeAppearance,
    resolveTheme,
    bestWeight,
    isNewRecord,
    recordDates,
    plateauStatus,
    exerciseSeries,
    ONE_REP_MAX_MAX_REPS,
    estimateOneRepMax,
    oneRepMaxSeries,
    bestOneRepMax,
    sampleData,
  };
})();
