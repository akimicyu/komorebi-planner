const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// ブラウザを使わず、実際のイベントハンドラーと保存結果を検証する。
const template = fs.readFileSync(path.join(__dirname, '../src/template.html'), 'utf8');
const source = fs.readFileSync(path.join(__dirname, '../src/app.js'), 'utf8');

function openTestApp(excludeWeekends, overrides = {}) {
  const task = (id, start, end, deps = [], extra = {}) => ({
    id,
    name: id,
    start,
    end,
    deps,
    owner: '',
    lag: 0,
    progress: 0,
    ...extra,
  });
  let saved = JSON.stringify({
    version: 1,
    name: 'テスト計画',
    excludeWeekends,
    target: 'all',
    tasks: [
      task('A', '2027-01-04', '2027-01-08'),
      task('B', '2027-01-05', '2027-01-06', ['A']),
      task('M', '2027-01-06', '2027-01-06', ['B'], { milestone: true }),
      task('S', '2027-01-05', '2027-01-06', ['A'], { progress: 20, actualStart: '2027-01-05' }),
    ],
    ...overrides,
  });
  const confirmations = [];
  const elements = Object.fromEntries(
    [...template.matchAll(/\bid="([^"]+)"/g)].map(([, id]) => [
      id,
      {
        value: '',
        checked: false,
        disabled: false,
        innerHTML: '',
        textContent: '',
        clientWidth: 1600,
        classList: { add() {}, remove() {} },
        reset() {},
        showModal() {},
        close() {},
        querySelectorAll(selector) {
          if (selector === '[data-id]') {
            return ['A', 'B', 'M', 'S'].map((id) => elements[id]);
          }
          return [...this.innerHTML.matchAll(/value="([^"]+)" checked/g)].map(([, value]) => ({
            value,
          }));
        },
      },
    ]),
  );
  for (const id of ['A', 'B', 'M', 'S']) {
    elements[id] = { dataset: { id } };
  }
  vm.runInNewContext(source, {
    document: { getElementById: (id) => elements[id] },
    window: { addEventListener() {} },
    localStorage: {
      getItem: () => saved,
      setItem: (key, value) => {
        saved = value;
      },
    },
    structuredClone,
    confirm(message) {
      confirmations.push(message);
      return true;
    },
    setTimeout: () => 1,
    clearTimeout() {},
  });
  return { elements, confirmations, readProject: () => JSON.parse(saved) };
}

for (const excludeWeekends of [false, true]) {
  const { elements, confirmations, readProject } = openTestApp(excludeWeekends);
  const originalMilestone = readProject().tasks.find((task) => task.id === 'M');
  const startedTask = readProject().tasks.find((task) => task.id === 'S');
  elements.schedule.onclick();
  assert.deepEqual(
    readProject().tasks.find((task) => task.id === 'M'),
    originalMilestone,
  );
  assert.deepEqual(
    readProject().tasks.find((task) => task.id === 'S'),
    startedTask,
  );
  const rescheduledTask = readProject().tasks.find((task) => task.id === 'B');
  assert.equal(rescheduledTask.start, excludeWeekends ? '2027-01-11' : '2027-01-09');
  assert.equal(rescheduledTask.end, excludeWeekends ? '2027-01-12' : '2027-01-10');
  assert(confirmations[0].startsWith('1件'));
  assert(elements.chart.innerHTML.includes('先行タスクと日程不整合'));
  elements.schedule.onclick();
  assert.equal(confirmations.length, 1);

  elements.M.onclick();
  assert.equal(elements.f_end.disabled, true);
  assert.equal(elements.f_end.value, elements.f_start.value);
  assert.equal(elements.milestoneDateHint.hidden, false);
  elements.f_start.value = '2027-01-07';
  elements.f_start.oninput();
  assert.equal(elements.f_end.value, '2027-01-07');
  elements.taskForm.onsubmit({ preventDefault() {} });
  assert.equal(elements.formError.textContent, '');
  const milestone = readProject().tasks.find((task) => task.id === 'M');
  assert.equal(milestone.start, '2027-01-07');
  assert.equal(milestone.end, milestone.start);
  assert.deepEqual(milestone.deps, ['B']);

  elements.B.onclick();
  assert.equal(elements.f_end.disabled, false);
  assert.equal(elements.milestoneDateHint.hidden, true);
  elements.f_milestone.checked = true;
  elements.f_milestone.onchange();
  assert.equal(elements.f_end.disabled, true);
  assert.equal(elements.f_end.value, elements.f_start.value);
  elements.f_milestone.checked = false;
  elements.f_milestone.onchange();
  assert.equal(elements.f_end.disabled, false);
  elements.f_end.value = '2027-01-20';
  elements.f_start.onchange();
  assert.equal(elements.f_end.value, '2027-01-20');
  elements.taskForm.onsubmit({ preventDefault() {} });
  assert.equal(readProject().tasks.find((task) => task.id === 'B').end, '2027-01-20');

  elements.M.onclick();
  elements.addTask.onclick();
  assert.equal(elements.f_end.disabled, false);
}
console.log(
  'PASS: fixed milestones, pending-only rescheduling, milestone date editing and saving in both calendars',
);

const automaticTargetApp = openTestApp(false, { statusDate: '2027-01-04' });
const targetFields = automaticTargetApp.elements;
assert.equal(targetFields.target.value, 'M');
targetFields.statusDate.onchange({ target: { value: '2027-01-07' } });
assert.equal(targetFields.target.value, 'all');
targetFields.statusDate.onchange({ target: { value: '2027-01-06' } });
assert.equal(targetFields.target.value, 'M');
assert.equal(openTestApp(false, automaticTargetApp.readProject()).elements.target.value, 'M');
targetFields.target.onchange({ target: { value: 'B' } });
targetFields.statusDate.onchange({ target: { value: '2027-01-08' } });
assert.equal(targetFields.target.value, 'B');
assert.equal(openTestApp(false, automaticTargetApp.readProject()).elements.target.value, 'B');
targetFields.target.onchange({ target: { value: 'all' } });
targetFields.statusDate.onchange({ target: { value: '2027-01-04' } });
assert.equal(targetFields.target.value, 'all');
assert.equal(openTestApp(false, automaticTargetApp.readProject()).elements.target.value, 'all');
assert.equal(openTestApp(false, { target: 'B' }).elements.target.value, 'B');
assert.equal(
  openTestApp(false, { target: 'deleted', statusDate: '2027-01-04' }).elements.target.value,
  'M',
);
console.log(
  'PASS: automatic target changes with status date, manual choices and legacy targets survive reload',
);
