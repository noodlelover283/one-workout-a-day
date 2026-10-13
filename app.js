// UI for One Workout a Day. Data lives in this browser's localStorage.
const STORAGE_KEY = "one-workout-a-day";
const SVG_NS = "http://www.w3.org/2000/svg";
const DEFAULT_REST = { seconds: 90, autoStart: true, sound: true };

let state = loadState();
I18n.setLanguage(state.language);

function loadState() {
  try {
    const loaded = normalizeState(JSON.parse(localStorage.getItem(STORAGE_KEY)));
    if (loaded) return loaded;
  } catch (error) {
    console.warn("Could not read saved workouts; starting fresh.", error);
  }
  return {
    entries: [],
    bodyweights: [],
    customExercises: {},
    stallDays: {},
    unit: "lb",
    routines: [],
    notes: {},
    sex: "",
    measurements: [],
    rest: { ...DEFAULT_REST },
    progression: { repGoal: Logic.DEFAULT_REP_GOAL, jumps: { lb: {}, kg: {} } },
    appearance: { ...Logic.DEFAULT_APPEARANCE },
    language: detectLanguage(),
  };
}

// Fills in anything missing from saved (or restored) data. Returns null if it is not workout data.
function normalizeState(saved) {
  if (!saved || !Array.isArray(saved.entries) || !Array.isArray(saved.bodyweights)) return null;
  const loaded = { customExercises: {}, stallDays: {}, unit: "lb", routines: [], ...saved };
  loaded.notes = Logic.sanitizeNotes(saved.notes);
  loaded.sex = Logic.STRENGTH_SEXES.includes(saved.sex) ? saved.sex : "";
  loaded.measurements = Logic.sanitizeMeasurements(saved.measurements);
  loaded.entries = Logic.migrateEntries(loaded.entries);
  loaded.rest = { ...DEFAULT_REST, ...saved.rest };
  loaded.progression = {
    repGoal: Logic.DEFAULT_REP_GOAL,
    ...saved.progression,
    jumps: { lb: {}, kg: {}, ...(saved.progression && saved.progression.jumps) },
  };
  loaded.appearance = Logic.sanitizeAppearance(saved.appearance);
  loaded.language = I18n.isSupported(saved.language) ? saved.language : detectLanguage();
  return loaded;
}

// First visit: use the browser's preferred language if we have text for it.
function detectLanguage() {
  return I18n.detect(navigator.languages || [navigator.language]);
}

function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (error) {
    showToast(t("toast.storage"));
  }
}

const $ = (id) => document.getElementById(id);
const t = I18n.t;
const today = () => Logic.toDateString(new Date());
const muscleOf = (exercise) => Logic.DEFAULT_EXERCISES[exercise] || state.customExercises[exercise] || "";
const stallDaysOf = (group) => state.stallDays[group] || Logic.STALL_DAYS;
// The weight jump for a muscle group, in the unit currently shown.
const jumpOf = (group) => state.progression.jumps[state.unit][group] || Logic.DEFAULT_WEIGHT_JUMPS[state.unit][group];

// Names stored in data stay in English; these give the text to show in the current language.
const muscleLabel = (group) => t(`muscle.${group}`);
const exerciseLabel = (name) => (I18n.has(`exercise.${name}`) ? t(`exercise.${name}`) : name);
const repsText = (count) => I18n.plural("reps", count);
const byLabel = (a, b) => exerciseLabel(a).localeCompare(exerciseLabel(b), I18n.locale());

// Finds the stored exercise name for what was typed, in English or in the current language.
function resolveExercise(typed) {
  const known = Logic.findKnownExercise(typed, state.customExercises);
  if (known) return known;
  const lower = Logic.normalizeName(typed).toLowerCase();
  return Object.keys(Logic.DEFAULT_EXERCISES).find((name) => exerciseLabel(name).toLowerCase() === lower) || null;
}

// Turns a validation result (an error key, or "") into text for the current language.
function errorText(key) {
  if (!key) return "";
  const params = { min: Logic.MIN_REST_SECONDS, max: Logic.MAX_REST_SECONDS, unit: state.unit, lengthUnit: Logic.lengthUnitFor(state.unit) };
  return t(key, params);
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function option(value, text) {
  return Object.assign(el("option", "", text), { value });
}

let toastTimer;
function showToast(message, { celebrate = false } = {}) {
  const toast = $("toast");
  toast.textContent = message;
  toast.classList.toggle("record", celebrate);
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), celebrate ? 5000 : 2200);
}

// ---------- Tabs ----------

function showTab(name) {
  for (const tab of document.querySelectorAll(".tab")) tab.classList.toggle("hidden", tab.id !== `tab-${name}`);
  for (const button of document.querySelectorAll(".tabbar button")) {
    button.classList.toggle("active", button.dataset.tab === name);
  }
  if (name === "log") {
    renderRoutinePicker();
    renderToday();
  }
  if (name === "routines") renderRoutines();
  if (name === "history") renderHistory();
  if (name === "progress") renderProgress();
}

// ---------- Log tab ----------

function renderExerciseOptions() {
  const names = Object.keys({ ...Logic.DEFAULT_EXERCISES, ...state.customExercises }).sort(byLabel);
  $("exercise-options").replaceChildren(...names.map((name) => Object.assign(el("option"), { value: exerciseLabel(name) })));
}

function updateMuscleRow() {
  const name = $("exercise").value;
  const isNew = Logic.normalizeName(name) !== "" && !resolveExercise(name);
  $("muscle-row").classList.toggle("hidden", !isNew);
  renderSuggestion();
}

// The set being edited, if any. Only one set is edited at a time, in whichever list shows it.
let editingEntryId = null;

function setRow(entry, number) {
  if (entry.id === editingEntryId) return editSetRow(entry, number);
  const item = el("li", "entry");
  const text = el("div");
  const weight = `${Logic.formatWeight(entry.weight, state.unit)} ${state.unit}`;
  text.append(el("strong", "", t("set.title", { n: number })), el("span", "detail", `${weight} × ${repsText(entry.reps)}`));
  const where = { n: number, exercise: exerciseLabel(entry.exercise), date: I18n.formatDate(entry.date) };
  const edit = el("button", "link", t("set.edit"));
  edit.type = "button";
  edit.setAttribute("aria-label", t("set.editAria", where));
  edit.addEventListener("click", () => startEditing(entry));
  const remove = el("button", "link", t("set.delete"));
  remove.type = "button";
  remove.setAttribute("aria-label", t("set.deleteAria", where));
  remove.addEventListener("click", () => deleteEntry(entry));
  const actions = el("div", "entry-actions");
  actions.append(edit, remove);
  item.append(text, actions);
  return item;
}

// The same row with the weight and reps turned into fields.
function editSetRow(entry, number) {
  const item = el("li", "entry editing");
  const form = el("form");
  form.noValidate = true;
  const exercise = Object.assign(el("input"), { value: exerciseLabel(entry.exercise), autocomplete: "off" });
  exercise.setAttribute("list", "exercise-options");
  const exerciseLabelNode = el("label", "", t("log.exercise"));
  exerciseLabelNode.append(exercise);
  // As on the Log form, a name we don't know yet needs a muscle group.
  const group = el("select");
  group.replaceChildren(...Logic.MUSCLE_GROUPS.map((g) => option(g, muscleLabel(g))));
  group.value = muscleOf(entry.exercise) || Logic.MUSCLE_GROUPS[0];
  const groupLabel = el("label", "hidden", t("log.newMuscle"));
  groupLabel.append(group);
  exercise.addEventListener("input", () => groupLabel.classList.toggle("hidden", !(Logic.normalizeName(exercise.value) && !resolveExercise(exercise.value))));
  const weight = Object.assign(el("input"), {
    type: "number",
    inputMode: "decimal",
    min: 0,
    step: "any",
    value: Logic.formatWeight(entry.weight, state.unit),
  });
  const reps = Object.assign(el("input"), { type: "number", inputMode: "numeric", min: 1, max: 100, value: entry.reps });
  const weightLabel = el("label", "", t("log.weight", { unit: state.unit }));
  weightLabel.append(weight);
  const repsLabel = el("label", "", t("log.reps"));
  repsLabel.append(reps);
  const fields = el("div", "row");
  fields.append(weightLabel, repsLabel);
  const error = el("p", "error");
  error.setAttribute("role", "alert");
  const save = el("button", "primary", t("set.save"));
  save.type = "submit";
  const cancel = el("button", "secondary", t("set.cancel"));
  cancel.type = "button";
  cancel.addEventListener("click", stopEditing);
  const buttons = el("div", "row");
  buttons.append(save, cancel);
  form.append(el("strong", "", t("set.title", { n: number })), exerciseLabelNode, groupLabel, fields, error, buttons);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const typed = resolveExercise(exercise.value) || Logic.normalizeName(exercise.value);
    saveEdit(entry, { exercise: typed, weight: parseFloat(weight.value), reps: parseInt(reps.value, 10) }, group.value, error);
  });
  form.addEventListener("keydown", (event) => {
    if (event.key === "Escape") stopEditing();
  });
  item.append(form);
  return item;
}

function startEditing(entry) {
  editingEntryId = entry.id;
  renderSetLists();
  const field = document.querySelector(".entry.editing input");
  if (field) field.focus();
}

function stopEditing() {
  editingEntryId = null;
  renderSetLists();
}

function saveEdit(entry, changes, group, errorNode) {
  const error = Logic.validateEntry(changes);
  errorNode.textContent = errorText(error);
  if (error) return;
  const result = Logic.updateSetDetails(state, entry.id, { ...changes, weight: Logic.toLb(changes.weight, state.unit) }, group);
  state.entries = result.entries;
  state.customExercises = result.customExercises;
  editingEntryId = null;
  saveState();
  if (result.moved) renderAfterExerciseChange();
  else renderSetLists();
  renderSuggestion();
  showToast(result.moved ? t("toast.setMoved", { exercise: exerciseLabel(result.exercise) }) : t("toast.setUpdated"));
}

function renderSetLists() {
  renderToday();
  renderHistory();
}

// One block per exercise, listing its sets in the order they were logged.
function exerciseGroups(entries) {
  return Logic.groupByExercise(entries).map((group) => {
    const block = el("li", "exercise-group");
    const list = el("ul", "entry-list");
    list.append(...group.sets.map((entry, index) => setRow(entry, index + 1)));
    block.append(el("h4", "", exerciseLabel(group.exercise)), list);
    return block;
  });
}

function deleteEntry(entry) {
  state.entries = state.entries.filter((e) => e.id !== entry.id);
  saveState();
  showToast(t("toast.deleted"));
  renderSetLists();
}

function renderToday() {
  const date = $("date").value || today();
  const list = $("today-list");
  const entries = state.entries.filter((e) => e.date === date);
  renderRoutineChecklist(entries);
  const note = $("workout-note");
  if (document.activeElement !== note) note.value = state.notes[date] || "";
  if (entries.length === 0) {
    list.replaceChildren(el("li", "empty", t("log.empty")));
    return;
  }
  list.replaceChildren(...exerciseGroups(entries));
}

function onLogSubmit(event) {
  event.preventDefault();
  const input = {
    exercise: Logic.normalizeName($("exercise").value),
    weight: parseFloat($("weight").value),
    reps: parseInt($("reps").value, 10),
  };
  const date = $("date").value;
  const error = date ? Logic.validateEntry(input) : "error.date";
  $("form-error").textContent = errorText(error);
  if (error) return;
  input.weight = Logic.toLb(input.weight, state.unit);

  const known = resolveExercise(input.exercise);
  if (known) {
    input.exercise = known;
  } else {
    state.customExercises[input.exercise] = $("muscle").value;
  }
  const previousBest = Logic.bestWeight(state.entries, input.exercise);
  state.entries.push({ id: String(Date.now()), date, ...input });
  saveState();

  renderExerciseOptions();
  updateMuscleRow();
  renderToday();
  if (state.rest.autoStart) startRest(state.rest.seconds);
  const setNumber = state.entries.filter((e) => e.date === date && e.exercise === input.exercise).length;
  const exercise = exerciseLabel(input.exercise);
  if (Logic.isNewRecord(previousBest, input.weight)) {
    const weight = Logic.formatWeight(input.weight, state.unit);
    const previous = Logic.formatWeight(previousBest, state.unit);
    showToast(t("toast.record", { exercise, weight, previous, unit: state.unit }), { celebrate: true });
  } else {
    showToast(t("toast.saved", { exercise, n: setNumber }));
  }
}

// ---------- Rest timer ----------

let restEndsAt = null;
let restTicker = null;
let audioContext = null;

// The timer counts down to a fixed end time, so it stays correct if the screen locks and wakes.
function startRest(seconds) {
  restEndsAt = Date.now() + seconds * 1000;
  prepareAudio();
  $("rest-banner").classList.remove("over");
  $("rest-banner").classList.remove("hidden");
  renderRestLabels();
  clearInterval(restTicker);
  restTicker = setInterval(updateRest, 250);
  updateRest();
}

// The banner's words depend on whether the rest is still running or has finished.
function renderRestLabels() {
  const over = $("rest-banner").classList.contains("over");
  $("rest-label").textContent = over ? t("rest.over") : t("rest.label");
  $("rest-skip").textContent = over ? t("rest.dismiss") : t("rest.skip");
}

function renderRestAdjustButtons() {
  for (const button of document.querySelectorAll("#rest-adjust button")) {
    const delta = Number(button.dataset.delta);
    button.textContent = delta < 0 ? t("rest.minus", { n: -delta }) : t("rest.plus", { n: delta });
  }
}

function updateRest() {
  if (restEndsAt === null) return;
  const secondsLeft = (restEndsAt - Date.now()) / 1000;
  if (secondsLeft <= 0) {
    finishRest();
    return;
  }
  $("rest-clock").textContent = Logic.formatClock(secondsLeft);
}

function adjustRest(deltaSeconds) {
  if (restEndsAt === null) return;
  restEndsAt += deltaSeconds * 1000;
  updateRest();
}

function finishRest() {
  clearInterval(restTicker);
  restEndsAt = null;
  $("rest-banner").classList.add("over");
  renderRestLabels();
  showToast(t("toast.restOver"));
  if (state.rest.sound) {
    beep();
    if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
  }
}

function dismissRest() {
  clearInterval(restTicker);
  restEndsAt = null;
  $("rest-banner").classList.add("hidden");
}

// Browsers only allow sound after a tap, so the audio context is created when a rest starts.
function prepareAudio() {
  try {
    audioContext = audioContext || new AudioContext();
    if (audioContext.state === "suspended") audioContext.resume();
  } catch (error) {
    audioContext = null;
  }
}

function beep() {
  if (!audioContext) return;
  for (const offset of [0, 0.3]) {
    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();
    oscillator.frequency.value = 880;
    gain.gain.value = 0.2;
    oscillator.connect(gain);
    gain.connect(audioContext.destination);
    oscillator.start(audioContext.currentTime + offset);
    oscillator.stop(audioContext.currentTime + offset + 0.2);
  }
}

function renderRestSettings() {
  $("rest-seconds").value = state.rest.seconds;
  $("rest-auto").checked = state.rest.autoStart;
  $("rest-sound").checked = state.rest.sound;
}

function onRestSecondsChange() {
  const seconds = parseInt($("rest-seconds").value, 10);
  const error = Logic.validateRestSeconds(seconds);
  $("rest-error").textContent = errorText(error);
  if (error) {
    $("rest-seconds").value = state.rest.seconds;
    return;
  }
  state.rest.seconds = seconds;
  saveState();
  showToast(t("toast.restTime", { time: Logic.formatClock(seconds) }));
}

function onRestToggleChange() {
  state.rest.autoStart = $("rest-auto").checked;
  state.rest.sound = $("rest-sound").checked;
  saveState();
}

// ---------- Exercise demonstrations ----------

// Form tips (when we have them) and a link to a demo video for the chosen exercise.
function renderDemo(exercise) {
  const box = $("demo");
  box.classList.toggle("hidden", !exercise);
  if (!exercise) return;
  const hasTip = I18n.has(`tip.${exercise}`);
  $("demo-tips").classList.toggle("hidden", !hasTip);
  if (hasTip) $("demo-tip").textContent = t(`tip.${exercise}`);
  const link = $("demo-link");
  link.href = Logic.demoUrl(exercise);
  link.setAttribute("aria-label", t("demo.watchLabel", { exercise: exerciseLabel(exercise) }));
}

// ---------- Weight suggestions ----------

function renderSuggestion() {
  const box = $("suggestion");
  const exercise = resolveExercise($("exercise").value);
  renderDemo(exercise);
  if (!exercise) {
    box.classList.add("hidden");
    return;
  }
  const date = $("date").value || today();
  // Only sessions before the chosen day count, so the suggestion stays put while you log sets.
  const history = state.entries.filter((e) => e.date < date);
  const group = muscleOf(exercise);
  const unit = state.unit;
  const suggestion = Logic.suggestNext(history, exercise, state.progression.repGoal, Logic.toLb(jumpOf(group), unit));
  box.classList.remove("hidden");
  const useButton = $("use-suggestion");
  if (!suggestion) {
    $("suggestion-text").textContent = t("suggest.none", { exercise: exerciseLabel(exercise) });
    $("suggestion-detail").textContent = t("suggest.noneDetail");
    $("suggestion-note").textContent = "";
    useButton.classList.add("hidden");
    return;
  }
  const weight = Logic.formatWeight(suggestion.weight, unit);
  const goal = repsText(state.progression.repGoal);
  const sets = suggestion.session.map((e) => `${Logic.formatWeight(e.weight, unit)}×${e.reps}`).join(", ");
  $("suggestion-text").textContent = t("suggest.text", { weight, unit, reps: repsText(suggestion.reps) });
  const reason = suggestion.increased
    ? t("suggest.reasonUp", { goal, jump: jumpOf(group), unit })
    : t("suggest.reasonRepeat", { goal, target: repsText(suggestion.reps) });
  const last = t("suggest.last", { date: I18n.formatDate(suggestion.sessionDate), sets, unit });
  $("suggestion-detail").textContent = `${reason} ${last}`;
  const status = Logic.plateauStatus(state.entries, muscleOf, today(), stallDaysOf).find((s) => s.group === group);
  $("suggestion-note").textContent =
    status && status.state === "stalled" ? t("suggest.stalled", { group: muscleLabel(group) }) : "";
  useButton.classList.remove("hidden");
  useButton.dataset.weight = weight;
  useButton.dataset.reps = suggestion.reps;
}

function onUseSuggestion() {
  const button = $("use-suggestion");
  $("weight").value = button.dataset.weight;
  $("reps").value = button.dataset.reps;
  $("weight").focus();
}

function renderProgressionSettings() {
  $("rep-goal").value = state.progression.repGoal;
  const rows = Logic.MUSCLE_GROUPS.map((group) => {
    const row = el("div", "setting-row");
    const label = el("label", "", t("progression.jump", { group: muscleLabel(group) }));
    label.htmlFor = `jump-${group}`;
    const input = el("input");
    input.id = `jump-${group}`;
    input.type = "number";
    input.inputMode = "decimal";
    input.min = "0";
    input.step = "any";
    input.value = jumpOf(group);
    input.addEventListener("change", () => onJumpChange(group, input));
    row.append(label, input, el("span", "unit", state.unit));
    return row;
  });
  $("jump-settings").replaceChildren(...rows);
}

function onJumpChange(group, input) {
  const jump = parseFloat(input.value);
  const error = Logic.validateWeightJump(jump);
  $("progression-error").textContent = error ? t("error.withGroup", { group: muscleLabel(group), message: errorText(error) }) : "";
  if (error) {
    input.value = jumpOf(group);
    return;
  }
  state.progression.jumps[state.unit][group] = jump;
  saveState();
  renderSuggestion();
  showToast(t("toast.jumpSet", { group: muscleLabel(group), jump, unit: state.unit }));
}

function onRepGoalChange() {
  const goal = parseInt($("rep-goal").value, 10);
  const error = Logic.validateRepGoal(goal);
  $("progression-error").textContent = errorText(error);
  if (error) {
    $("rep-goal").value = state.progression.repGoal;
    return;
  }
  state.progression.repGoal = goal;
  saveState();
  renderSuggestion();
  showToast(t("toast.repGoal", { goal }));
}

// ---------- Starting a routine (Log tab) ----------

function renderRoutinePicker() {
  const select = $("routine-select");
  const previous = select.value;
  const options = [option("", t("routine.choose")), ...state.routines.map((routine) => option(routine.id, routine.name))];
  select.replaceChildren(...options);
  if (state.routines.some((r) => r.id === previous)) select.value = previous;
  select.classList.toggle("hidden", state.routines.length === 0);
  $("routine-hint").classList.toggle("hidden", state.routines.length > 0);
  document.querySelector('label[for="routine-select"]').classList.toggle("hidden", state.routines.length === 0);
}

function renderRoutineChecklist(todaysEntries) {
  const routine = state.routines.find((r) => r.id === $("routine-select").value);
  const list = $("routine-checklist");
  if (!routine) {
    list.replaceChildren();
    return;
  }
  const loggedToday = new Set(todaysEntries.map((e) => e.exercise));
  const current = resolveExercise($("exercise").value);
  const timesInRoutine = (exercise) => routine.exercises.filter((e) => e === exercise).length;
  list.replaceChildren(
    ...routine.exercises.map((exercise, index) => {
      const done = loggedToday.has(exercise);
      const total = timesInRoutine(exercise);
      const position = routine.exercises.slice(0, index + 1).filter((e) => e === exercise).length;
      const name =
        total > 1 ? t("routine.repeat", { name: exerciseLabel(exercise), position, total }) : exerciseLabel(exercise);
      const chip = el("button", "chip", done ? `✓ ${name}` : name);
      chip.type = "button";
      chip.classList.toggle("done", done);
      chip.classList.toggle("selected", exercise === current);
      chip.setAttribute("aria-label", done ? t("routine.loggedAria", { name }) : name);
      chip.addEventListener("click", () => pickRoutineExercise(exercise));
      const item = el("li");
      item.append(chip);
      return item;
    })
  );
}

// Fills the form with an exercise and, if it has been done before, last time's weight and reps.
function pickRoutineExercise(exercise) {
  $("exercise").value = exerciseLabel(exercise);
  const last = Logic.lastSet(state.entries, exercise);
  $("weight").value = last ? Logic.formatWeight(last.weight, state.unit) : "";
  $("reps").value = last ? last.reps : "";
  updateMuscleRow();
  renderRoutineChecklist(state.entries.filter((e) => e.date === ($("date").value || today())));
  $("weight").focus();
}

// ---------- Routines tab ----------

let draftExercises = [];
let editingRoutineId = null;

function allExerciseNames() {
  return Object.keys({ ...Logic.DEFAULT_EXERCISES, ...state.customExercises }).sort(byLabel);
}

function renderRoutines() {
  const list = $("routine-list");
  if (state.routines.length === 0) {
    list.replaceChildren(el("p", "empty", t("routines.empty")));
  } else {
    list.replaceChildren(
      ...state.routines.map((routine) => {
        const card = el("div", "routine-card");
        const header = el("div", "entry-header");
        header.append(el("strong", "", routine.name));
        const actions = el("div", "routine-actions");
        const edit = el("button", "link", t("routines.edit"));
        edit.type = "button";
        edit.setAttribute("aria-label", t("routines.editAria", { name: routine.name }));
        edit.addEventListener("click", () => startEditingRoutine(routine));
        const remove = el("button", "link", t("routines.delete"));
        remove.type = "button";
        remove.setAttribute("aria-label", t("routines.deleteAria", { name: routine.name }));
        remove.addEventListener("click", () => deleteRoutine(routine));
        actions.append(edit, remove);
        header.append(actions);
        card.append(header, el("p", "", routine.exercises.map(exerciseLabel).join(" · ")));
        return card;
      })
    );
  }
  $("routine-exercise-select").replaceChildren(...allExerciseNames().map((name) => option(name, exerciseLabel(name))));
  renderRoutineFormText();
  renderRoutineDraft();
  renderMyExercises();
}

// ---------- My exercises (edit or delete the ones added on the Log tab) ----------

let editingExerciseName = null;

function renderMyExercises() {
  const names = Object.keys(state.customExercises).sort(byLabel);
  $("my-exercises").replaceChildren(
    ...(names.length === 0
      ? [el("p", "empty", t("myex.empty"))]
      : names.map((name) => (name === editingExerciseName ? editExerciseCard(name) : exerciseCard(name))))
  );
}

function exerciseCard(name) {
  const card = el("div", "routine-card");
  const header = el("div", "entry-header");
  header.append(el("strong", "", name));
  const edit = el("button", "link", t("routines.edit"));
  edit.type = "button";
  edit.setAttribute("aria-label", t("myex.editAria", { name }));
  edit.addEventListener("click", () => startEditingExercise(name));
  const remove = el("button", "link", t("routines.delete"));
  remove.type = "button";
  remove.setAttribute("aria-label", t("myex.deleteAria", { name }));
  remove.addEventListener("click", () => deleteCustomExercise(name));
  const actions = el("div", "routine-actions");
  actions.append(edit, remove);
  header.append(actions);
  card.append(header, el("p", "", muscleLabel(state.customExercises[name])));
  return card;
}

function editExerciseCard(name) {
  const card = el("form", "routine-card");
  card.noValidate = true;
  const nameInput = Object.assign(el("input"), { value: name, autocomplete: "off" });
  const nameLabel = el("label", "", t("routines.name"));
  nameLabel.append(nameInput);
  const group = el("select");
  group.replaceChildren(...Logic.MUSCLE_GROUPS.map((g) => option(g, muscleLabel(g))));
  group.value = state.customExercises[name];
  const groupLabel = el("label", "", t("myex.muscle"));
  groupLabel.append(group);
  const error = el("p", "error");
  error.setAttribute("role", "alert");
  const save = el("button", "primary", t("set.save"));
  save.type = "submit";
  const cancel = el("button", "secondary", t("set.cancel"));
  cancel.type = "button";
  cancel.addEventListener("click", stopEditingExercise);
  card.append(nameLabel, groupLabel, error, save, cancel);
  card.addEventListener("submit", (event) => {
    event.preventDefault();
    saveExerciseEdit(name, nameInput.value, group.value, error);
  });
  card.addEventListener("keydown", (event) => {
    if (event.key === "Escape") stopEditingExercise();
  });
  return card;
}

function startEditingExercise(name) {
  editingExerciseName = name;
  renderMyExercises();
  document.querySelector("#my-exercises input").focus();
}

function stopEditingExercise() {
  editingExerciseName = null;
  renderMyExercises();
}

function saveExerciseEdit(name, newName, group, errorNode) {
  const error = Logic.normalizeName(newName) ? "" : "error.exerciseName";
  errorNode.textContent = errorText(error);
  if (error) return;
  const result = Logic.renameExercise(state, name, newName, group);
  if (result.merging && !window.confirm(t("myex.mergeConfirm", { from: name, to: result.newName, sets: Logic.exerciseUsage(state, name).sets }))) return;
  state.entries = result.entries;
  state.routines = result.routines;
  state.customExercises = result.customExercises;
  // A routine being edited right now keeps its place, with the new name and no duplicate.
  draftExercises = draftExercises.map((exercise) => (exercise === name ? result.newName : exercise)).filter((exercise, index, all) => all.indexOf(exercise) === index);
  editingExerciseName = null;
  saveState();
  renderAfterExerciseChange();
  showToast(t("toast.exerciseSaved"));
}

function deleteCustomExercise(name) {
  const usage = Logic.exerciseUsage(state, name);
  if (!window.confirm(t("myex.deleteConfirm", { name, sets: usage.sets, routines: usage.routines }))) return;
  const result = Logic.deleteExercise(state, name);
  state.entries = result.entries;
  state.routines = result.routines;
  state.customExercises = result.customExercises;
  draftExercises = draftExercises.filter((exercise) => exercise !== name);
  saveState();
  renderAfterExerciseChange();
  showToast(t("toast.routineDeleted", { name }));
}

// Exercise names appear in almost every list, so refresh them all after a rename or delete.
function renderAfterExerciseChange() {
  renderExerciseOptions();
  renderRoutines();
  renderRoutinePicker();
  renderToday();
  renderHistory();
  renderProgress();
  renderSuggestion();
}

// The form's title and save button change while an existing routine is being edited.
function renderRoutineFormText() {
  const editing = state.routines.find((r) => r.id === editingRoutineId);
  $("routine-form-title").textContent = editing ? t("routines.editingTitle", { name: editing.name }) : t("routines.newTitle");
  $("routine-save").textContent = editing ? t("routines.update") : t("routines.save");
}

function renderRoutineDraft() {
  const draft = $("routine-draft");
  if (draftExercises.length === 0) {
    draft.replaceChildren(el("li", "empty", t("routines.draftEmpty")));
    return;
  }
  draft.replaceChildren(
    ...draftExercises.map((exercise, index) => {
      const item = el("li", "entry");
      item.append(el("span", "", `${index + 1}. ${exerciseLabel(exercise)}`));
      const remove = el("button", "link", t("routines.remove"));
      remove.type = "button";
      remove.setAttribute("aria-label", t("routines.removeAria", { exercise: exerciseLabel(exercise) }));
      remove.addEventListener("click", () => {
        draftExercises.splice(index, 1);
        renderRoutineDraft();
      });
      item.append(remove);
      return item;
    })
  );
}

function addDraftExercise() {
  const exercise = $("routine-exercise-select").value;
  if (!exercise) return;
  $("routine-error").textContent = "";
  draftExercises.push(exercise);
  renderRoutineDraft();
}

function resetRoutineForm() {
  editingRoutineId = null;
  draftExercises = [];
  $("routine-name").value = "";
  $("routine-error").textContent = "";
  $("routine-cancel").classList.add("hidden");
  renderRoutineFormText();
  renderRoutineDraft();
}

function startEditingRoutine(routine) {
  editingRoutineId = routine.id;
  draftExercises = [...routine.exercises];
  $("routine-name").value = routine.name;
  $("routine-error").textContent = "";
  $("routine-cancel").classList.remove("hidden");
  renderRoutineFormText();
  renderRoutineDraft();
  $("routine-name").focus();
}

function deleteRoutine(routine) {
  state.routines = state.routines.filter((r) => r.id !== routine.id);
  if (editingRoutineId === routine.id) resetRoutineForm();
  saveState();
  renderRoutines();
  showToast(t("toast.routineDeleted", { name: routine.name }));
}

function onRoutineSubmit(event) {
  event.preventDefault();
  const routine = { name: Logic.normalizeName($("routine-name").value), exercises: [...draftExercises] };
  const error = Logic.validateRoutine(routine);
  $("routine-error").textContent = errorText(error);
  if (error) return;
  if (editingRoutineId) {
    state.routines = state.routines.map((r) => (r.id === editingRoutineId ? { ...r, ...routine } : r));
  } else {
    state.routines.push({ id: String(Date.now()), ...routine });
  }
  saveState();
  showToast(t("toast.routineSaved", { name: routine.name }));
  resetRoutineForm();
  renderRoutines();
}

// ---------- History tab ----------

// ---------- Calendar ----------

let calendarMonth = null; // { year, month } being shown; starts on the current month

// 0 = Sunday ... 6 = Saturday, from the language's locale when the browser can tell us.
function weekStartDay() {
  const locale = new Intl.Locale(I18n.locale());
  const info = locale.getWeekInfo ? locale.getWeekInfo() : locale.weekInfo;
  return info ? info.firstDay % 7 : 0;
}

function showCalendarMonth(change) {
  const { year, month } = calendarMonth;
  const shifted = new Date(year, month + change, 1);
  calendarMonth = { year: shifted.getFullYear(), month: shifted.getMonth() };
  renderCalendar();
}

function renderCalendar() {
  if (!calendarMonth) {
    const now = new Date();
    calendarMonth = { year: now.getFullYear(), month: now.getMonth() };
  }
  const { year, month } = calendarMonth;
  const locale = I18n.locale();
  const weekStart = weekStartDay();
  const workoutDates = new Set(state.entries.map((e) => e.date));
  const todayDate = today();

  $("calendar-title").textContent = new Intl.DateTimeFormat(locale, { month: "long", year: "numeric" }).format(new Date(year, month, 1));
  // 4 January 2026 is a Sunday, so it gives the weekday names in order.
  const weekdays = Array.from({ length: 7 }, (_, i) => {
    const name = new Intl.DateTimeFormat(locale, { weekday: "narrow" }).format(new Date(2026, 0, 4 + ((weekStart + i) % 7)));
    return el("span", "weekday", name);
  });
  const days = Logic.monthCells(year, month, weekStart).map((date) => {
    if (!date) return el("span");
    const dayNumber = Number(date.slice(8));
    const hasWorkout = workoutDates.has(date);
    const cell = el(hasWorkout ? "button" : "span", "day-cell", String(dayNumber));
    if (date === todayDate) cell.classList.add("today");
    if (state.notes[date]) cell.classList.add("has-note");
    if (hasWorkout) {
      cell.type = "button";
      cell.setAttribute("aria-label", t("calendar.dayAria", { date: I18n.formatDate(date) }));
      cell.addEventListener("click", () => showHistoryDay(date));
    }
    return cell;
  });
  $("calendar-grid").replaceChildren(...weekdays, ...days);

  const prefix = `${year}-${String(month + 1).padStart(2, "0")}-`;
  const thisMonth = [...workoutDates].filter((date) => date.startsWith(prefix)).length;
  $("calendar-stats").textContent = t("calendar.stats", {
    count: thisMonth,
    streak: I18n.weeksText(Logic.currentWeeklyStreak(workoutDates, todayDate, weekStart)),
  });
}

// Scrolls the history list to a day and briefly highlights it.
function showHistoryDay(date) {
  const day = document.getElementById(`day-${date}`);
  if (!day) return;
  day.scrollIntoView({ block: "start" });
  day.classList.remove("flash");
  void day.offsetWidth; // restarts the highlight if the same day is tapped twice
  day.classList.add("flash");
}

// Saves the note for the day shown in the date field.
function onNoteChange() {
  const date = $("date").value || today();
  state.notes = Logic.setNote(state.notes, date, $("workout-note").value);
  $("workout-note").value = state.notes[date] || "";
  saveState();
  renderHistory();
  showToast(t(state.notes[date] ? "toast.noteSaved" : "toast.noteRemoved"));
}

function renderHistory() {
  renderCalendar();
  const container = $("history");
  const sample = $("load-sample");
  if (state.entries.length === 0 && Object.keys(state.notes).length === 0) {
    container.replaceChildren(el("p", "empty", t("history.empty")));
    sample.classList.remove("hidden");
    return;
  }
  sample.classList.add("hidden");
  const dates = [...new Set([...state.entries.map((e) => e.date), ...Object.keys(state.notes)])].sort().reverse();
  container.replaceChildren(
    ...dates.map((date) => {
      const group = el("section", "day");
      group.id = `day-${date}`;
      group.append(el("h3", "", I18n.formatDate(date)));
      if (state.notes[date]) group.append(el("p", "day-note", state.notes[date]));
      const list = el("ul", "entry-list");
      list.append(...exerciseGroups(state.entries.filter((e) => e.date === date)));
      group.append(list);
      return group;
    })
  );
}

function onLoadSample() {
  const sample = Logic.sampleData(today());
  state.entries.push(...sample.entries);
  state.bodyweights.push(...sample.bodyweights);
  saveState();
  renderHistory();
  showToast(t("toast.sample"));
}

// ---------- Backup and restore ----------

function onBackupDownload() {
  const backup = Logic.makeBackup(state, new Date().toISOString());
  const file = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
  const link = Object.assign(el("a"), { href: URL.createObjectURL(file), download: `one-workout-a-day-${today()}.json` });
  link.click();
  URL.revokeObjectURL(link.href);
  showToast(t("toast.backupSaved"));
}

async function onBackupFileChosen(event) {
  const input = event.target;
  const file = input.files[0];
  input.value = ""; // lets the same file be chosen again
  if (!file) return;
  const result = Logic.parseBackup(await file.text());
  const restored = result.data && normalizeState(result.data);
  if (!restored) {
    $("backup-error").textContent = errorText(result.error || "error.backupFile");
    return;
  }
  $("backup-error").textContent = "";
  const date = result.exportedAt ? I18n.formatDate(Logic.toDateString(new Date(result.exportedAt))) : "?";
  if (!window.confirm(t("backup.confirm", { date, count: restored.entries.length }))) return;
  state = restored;
  I18n.setLanguage(state.language);
  saveState();
  applyAppearance();
  renderRestSettings();
  applyLanguage();
  showToast(t("toast.backupRestored"));
}

// ---------- Progress tab ----------

function plateauText(status) {
  if (status.state === "stalled") {
    return t("plateau.stalled", { since: I18n.daysText(status.sinceRecord), limit: I18n.daysText(status.stallDays) });
  }
  if (status.state === "progressing") {
    return t("plateau.progressing", { when: I18n.daysAgoText(status.sinceRecord), limit: I18n.daysText(status.stallDays) });
  }
  return t("plateau.new", { sessions: status.sessions, needed: Logic.MIN_SESSIONS_TO_JUDGE });
}

function renderPlateaus() {
  const container = $("plateau-cards");
  const statuses = Logic.plateauStatus(state.entries, muscleOf, today(), stallDaysOf);
  if (statuses.length === 0) {
    container.replaceChildren(el("p", "empty", t("progress.plateauEmpty")));
    return;
  }
  container.replaceChildren(
    ...statuses.map((s) => {
      const card = el("div", `card ${s.state}`);
      card.append(el("strong", "", muscleLabel(s.group)), el("span", "badge", t(`badge.${s.state}`)));
      card.append(el("p", "", plateauText(s)));
      return card;
    })
  );
}

function renderStallSettings() {
  const rows = Logic.MUSCLE_GROUPS.map((group) => {
    const row = el("div", "setting-row");
    const label = el("label", "", muscleLabel(group));
    label.htmlFor = `stall-${group}`;
    const input = el("input");
    input.id = `stall-${group}`;
    input.type = "number";
    input.inputMode = "numeric";
    input.min = "1";
    input.max = "365";
    input.value = stallDaysOf(group);
    input.addEventListener("change", () => onStallDaysChange(group, input));
    row.append(label, input, el("span", "unit", t("unit.days")));
    return row;
  });
  $("stall-settings").replaceChildren(...rows);
}

function onStallDaysChange(group, input) {
  const days = parseInt(input.value, 10);
  const error = Logic.validateStallDays(days);
  $("stall-error").textContent = error ? t("error.withGroup", { group: muscleLabel(group), message: errorText(error) }) : "";
  if (error) {
    input.value = stallDaysOf(group);
    return;
  }
  state.stallDays[group] = days;
  saveState();
  renderPlateaus();
  showToast(t("toast.stallSet", { group: muscleLabel(group), days: I18n.daysText(days) }));
}

function renderExerciseChart() {
  const select = $("progress-exercise");
  const metric = $("progress-metric");
  const names = [...new Set(state.entries.map((e) => e.exercise))].sort(byLabel);
  const previous = select.value;
  select.replaceChildren(...names.map((name) => option(name, exerciseLabel(name))));
  if (names.includes(previous)) select.value = previous;
  const chart = $("exercise-chart");
  if (names.length === 0) {
    select.disabled = true;
    metric.disabled = true;
    chart.replaceChildren(el("p", "empty", t("progress.noExercises")));
    renderOneRepMaxNote(null);
    return;
  }
  select.disabled = false;
  metric.disabled = false;
  const series =
    metric.value === "oneRepMax"
      ? Logic.oneRepMaxSeries(state.entries, select.value)
      : Logic.exerciseSeries(state.entries, select.value);
  chart.replaceChildren(lineChart(inDisplayUnit(series)));
  renderOneRepMaxNote(Logic.bestOneRepMax(state.entries, select.value));
}

// The best estimate for the chosen exercise, and how far to trust it.
function renderOneRepMaxNote(best) {
  const unit = state.unit;
  $("one-rep-max-best").textContent = best
    ? t("progress.oneRepMaxBest", {
        value: Logic.formatWeight(best.value, unit),
        weight: Logic.formatWeight(best.weight, unit),
        reps: repsText(best.reps),
        unit,
        date: I18n.formatDate(best.date),
      })
    : $("progress-exercise").disabled
      ? ""
      : t("progress.oneRepMaxNone", { max: Logic.ONE_REP_MAX_MAX_REPS });
  $("one-rep-max-hint").textContent = $("progress-exercise").disabled ? "" : t("progress.oneRepMaxHint", { max: Logic.ONE_REP_MAX_MAX_REPS });
}

// Chart data is stored in pounds; convert it to the unit the user picked.
function inDisplayUnit(series) {
  return series.map((point) => ({ date: point.date, value: Number(Logic.formatWeight(point.value, state.unit)) }));
}

function renderBodyweightChart() {
  const series = [...state.bodyweights].sort((a, b) => a.date.localeCompare(b.date)).map((b) => ({ date: b.date, value: b.weight }));
  const chart = $("bodyweight-chart");
  chart.replaceChildren(series.length === 0 ? el("p", "empty", t("progress.noBodyweight")) : lineChart(inDisplayUnit(series)));
}

// ---------- Strength levels ----------

function renderStrength() {
  const select = $("strength-sex");
  select.replaceChildren(option("", t("strength.sexChoose")), ...Logic.STRENGTH_SEXES.map((sex) => option(sex, t(`strength.${sex}`))));
  select.value = state.sex;
  const results = $("strength-results");
  const bodyweight = Logic.latestBodyweight(state.bodyweights);
  if (!state.sex) {
    results.replaceChildren(el("p", "empty", t("strength.needSex")));
  } else if (bodyweight === null) {
    results.replaceChildren(el("p", "empty", t("strength.needBodyweight")));
  } else {
    results.replaceChildren(...Logic.STRENGTH_LIFTS.map((lift) => strengthCard(lift, bodyweight)));
  }
}

function strengthCard(lift, bodyweight) {
  const card = el("div", "strength-card");
  const best = Logic.bestOneRepMax(state.entries, lift);
  const result = best && Logic.strengthLevel(state.sex, lift, best.value, bodyweight);
  if (!result) {
    card.append(el("p", "level-name", exerciseLabel(lift)), el("p", "hint", t("strength.notLogged")));
    return card;
  }
  const unit = state.unit;
  const levelName = result.level ? t(`strength.level.${result.level}`) : t("strength.level.start");
  const meter = el("div", "level-meter");
  meter.setAttribute("aria-hidden", "true");
  meter.append(...Logic.STRENGTH_LEVELS.map((level, index) => el("span", index <= result.reached ? "reached" : "")));
  const ratio = result.ratio.toLocaleString(I18n.locale(), { maximumFractionDigits: 2 });
  const detail = t("strength.detail", { value: Logic.formatWeight(best.value, unit), unit, ratio });
  const next = result.next
    ? t("strength.next", {
        level: t(`strength.level.${result.next.level}`),
        weight: Logic.formatWeight(result.next.weight, unit),
        unit,
        more: Logic.formatWeight(result.next.weight - best.value, unit),
      })
    : t("strength.top");
  card.append(el("p", "level-name", `${exerciseLabel(lift)}: ${levelName}`), meter, el("p", "hint", detail), el("p", "hint", next));
  return card;
}

function onStrengthSexChange() {
  state.sex = $("strength-sex").value;
  saveState();
  renderStrength();
}

function renderMeasurementChart() {
  const select = $("measure-name");
  const previous = select.value;
  select.replaceChildren(...Logic.MEASUREMENTS.map((name) => option(name, t(`measure.${name}`))));
  if (Logic.MEASUREMENTS.includes(previous)) select.value = previous;
  const unit = Logic.lengthUnitFor(state.unit);
  $("measure-value").placeholder = t("measure.placeholder", { unit });
  const series = Logic.measurementSeries(state.measurements, select.value).map((point) => ({
    date: point.date,
    value: Number(Logic.formatLength(point.value, state.unit)),
  }));
  $("measure-chart").replaceChildren(
    series.length === 0 ? el("p", "empty", t("measure.none", { name: t(`measure.${select.value}`) })) : lineChart(series, unit),
  );
}

function onMeasurementSubmit(event) {
  event.preventDefault();
  const name = $("measure-name").value;
  const cm = Logic.lengthToCm(parseFloat($("measure-value").value), state.unit);
  const error = Logic.validateMeasurement(cm);
  $("measure-error").textContent = errorText(error);
  if (error) return;
  state.measurements = Logic.setMeasurement(state.measurements, { date: today(), name, cm });
  saveState();
  $("measure-value").value = "";
  renderMeasurementChart();
  showToast(t("toast.measurementSaved", { name: t(`measure.${name}`) }));
}

function lineChart(series, unit = state.unit) {
  if (series.length < 2) {
    const only = series[0];
    const message = only
      ? t("chart.onePoint", { value: only.value, unit, date: I18n.formatDate(only.date) })
      : t("chart.noData");
    return el("p", "empty", message);
  }
  const width = 320, height = 160, pad = 28;
  const values = series.map((p) => p.value);
  const min = Math.min(...values), max = Math.max(...values);
  const span = max - min || 1;
  const t0 = Date.parse(series[0].date), t1 = Date.parse(series[series.length - 1].date);
  const x = (p) => pad + ((Date.parse(p.date) - t0) / (t1 - t0 || 1)) * (width - pad * 2);
  const y = (p) => height - pad - ((p.value - min) / span) * (height - pad * 2);

  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", t("chart.aria", { from: series[0].value, to: series[series.length - 1].value, unit }));

  const add = (tag, attrs, text) => {
    const node = document.createElementNS(SVG_NS, tag);
    for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
    if (text !== undefined) node.textContent = text;
    svg.append(node);
  };
  add("polyline", { points: series.map((p) => `${x(p)},${y(p)}`).join(" "), class: "line" });
  for (const p of series) add("circle", { cx: x(p), cy: y(p), r: 3.5, class: "dot" });
  add("text", { x: 4, y: pad, class: "axis" }, `${max}`);
  add("text", { x: 4, y: height - pad + 4, class: "axis" }, `${min}`);
  add("text", { x: pad, y: height - 6, class: "axis" }, I18n.formatShortDate(series[0].date));
  add("text", { x: width - pad, y: height - 6, class: "axis", "text-anchor": "end" }, I18n.formatShortDate(series[series.length - 1].date));
  return svg;
}

function onBodyweightSubmit(event) {
  event.preventDefault();
  const weight = parseFloat($("bodyweight").value);
  const error = weight > 0 && weight < 700 ? "" : "error.bodyweight";
  $("bodyweight-error").textContent = errorText(error);
  if (error) return;
  const date = today();
  state.bodyweights = state.bodyweights.filter((b) => b.date !== date);
  state.bodyweights.push({ date, weight: Logic.toLb(weight, state.unit) });
  saveState();
  $("bodyweight").value = "";
  renderBodyweightChart();
  renderStrength();
  showToast(t("toast.bodyweight"));
}

function renderProgress() {
  renderPlateaus();
  renderStallSettings();
  renderExerciseChart();
  renderBodyweightChart();
  renderStrength();
  renderMeasurementChart();
}

// ---------- Display settings ----------

const deviceDarkQuery = window.matchMedia("(prefers-color-scheme: dark)");

function applyAppearance() {
  const { theme, textSize } = state.appearance;
  document.documentElement.dataset.theme = Logic.resolveTheme(theme, deviceDarkQuery.matches);
  document.documentElement.style.fontSize = `${textSize}%`;
  $("theme-select").value = theme;
  $("text-size-select").value = String(textSize);
}

function onAppearanceChange() {
  state.appearance = Logic.sanitizeAppearance({
    theme: $("theme-select").value,
    textSize: parseInt($("text-size-select").value, 10),
  });
  saveState();
  applyAppearance();
}

// ---------- Language ----------

// Fills in every piece of fixed text on the page, marked with data-i18n attributes in index.html.
function translatePage() {
  document.documentElement.lang = I18n.current();
  document.documentElement.dir = I18n.direction();
  document.title = t("app.title");
  for (const node of document.querySelectorAll("[data-i18n]")) node.textContent = t(node.dataset.i18n);
  for (const node of document.querySelectorAll("[data-i18n-placeholder]")) node.placeholder = t(node.dataset.i18nPlaceholder);
  for (const node of document.querySelectorAll("[data-i18n-aria]")) node.setAttribute("aria-label", t(node.dataset.i18nAria));
}

function renderMuscleOptions() {
  const select = $("muscle");
  const previous = select.value;
  select.replaceChildren(...Logic.MUSCLE_GROUPS.map((group) => option(group, muscleLabel(group))));
  if (previous) select.value = previous;
}

// Switches the language and redraws everything that contains text.
function applyLanguage() {
  translatePage();
  $("language-select").value = I18n.current();
  renderMuscleOptions();
  renderRestAdjustButtons();
  renderRestLabels();
  applyUnit();
  renderExerciseOptions();
  renderProgressionSettings();
  renderSuggestion();
  renderRoutinePicker();
  renderToday();
  renderRoutines();
  renderHistory();
  renderProgress();
}

function onLanguageChange() {
  I18n.setLanguage($("language-select").value);
  state.language = I18n.current();
  saveState();
  applyLanguage();
}

// ---------- Units ----------

function applyUnit() {
  $("weight-label").textContent = t("log.weight", { unit: state.unit });
  $("weight").placeholder = state.unit === "kg" ? "60" : "135";
  $("bodyweight").placeholder = t("progress.bodyweightPlaceholder", { unit: state.unit });
  for (const button of document.querySelectorAll(".unit-toggle button")) {
    button.setAttribute("aria-pressed", String(button.dataset.unit === state.unit));
  }
}

function setUnit(unit) {
  if (unit === state.unit) return;
  state.unit = unit;
  saveState();
  applyUnit();
  renderProgressionSettings();
  renderSuggestion();
  renderToday();
  renderHistory();
  renderProgress();
  showToast(t("toast.unit", { unit }));
}

// ---------- Setup ----------

// The tab bar is fixed to the bottom of the screen, so the page keeps clear space equal to its height.
function keepClearOfTabBar() {
  const tabbar = document.querySelector(".tabbar");
  const update = () => document.documentElement.style.setProperty("--tabbar-height", `${tabbar.offsetHeight}px`);
  new ResizeObserver(update).observe(tabbar);
  update();
}

function init() {
  keepClearOfTabBar();
  applyAppearance();
  $("theme-select").addEventListener("change", onAppearanceChange);
  $("text-size-select").addEventListener("change", onAppearanceChange);
  deviceDarkQuery.addEventListener("change", applyAppearance);
  $("language-select").replaceChildren(...I18n.available().map((language) => option(language.code, language.name)));
  $("language-select").addEventListener("change", onLanguageChange);
  $("date").value = today();

  $("log-form").addEventListener("submit", onLogSubmit);
  $("workout-note").maxLength = Logic.NOTE_MAX_LENGTH;
  $("workout-note").addEventListener("change", onNoteChange);
  $("exercise").addEventListener("input", updateMuscleRow);
  $("date").addEventListener("change", () => {
    renderToday();
    renderSuggestion();
  });
  $("use-suggestion").addEventListener("click", onUseSuggestion);
  $("rep-goal").addEventListener("change", onRepGoalChange);
  $("routine-form").addEventListener("submit", onRoutineSubmit);
  $("routine-add-exercise").addEventListener("click", addDraftExercise);
  $("routine-cancel").addEventListener("click", resetRoutineForm);
  $("routine-select").addEventListener("change", renderToday);
  $("rest-seconds").addEventListener("change", onRestSecondsChange);
  $("rest-auto").addEventListener("change", onRestToggleChange);
  $("rest-sound").addEventListener("change", onRestToggleChange);
  $("rest-skip").addEventListener("click", dismissRest);
  for (const button of document.querySelectorAll("#rest-adjust button")) {
    button.addEventListener("click", () => adjustRest(Number(button.dataset.delta)));
  }
  document.addEventListener("visibilitychange", updateRest);
  renderRestSettings();
  $("bodyweight-form").addEventListener("submit", onBodyweightSubmit);
  $("strength-sex").addEventListener("change", onStrengthSexChange);
  $("measure-form").addEventListener("submit", onMeasurementSubmit);
  $("measure-name").addEventListener("change", renderMeasurementChart);
  $("progress-exercise").addEventListener("change", renderExerciseChart);
  $("progress-metric").addEventListener("change", renderExerciseChart);
  $("load-sample").addEventListener("click", onLoadSample);
  $("calendar-prev").addEventListener("click", () => showCalendarMonth(-1));
  $("calendar-next").addEventListener("click", () => showCalendarMonth(1));
  $("backup-download").addEventListener("click", onBackupDownload);
  $("backup-file").addEventListener("change", onBackupFileChosen);
  for (const button of document.querySelectorAll(".tabbar button")) {
    button.addEventListener("click", () => showTab(button.dataset.tab));
  }
  for (const button of document.querySelectorAll(".unit-toggle button")) {
    button.addEventListener("click", () => setUnit(button.dataset.unit));
  }
  applyLanguage();
  showTab("log");
}

init();
