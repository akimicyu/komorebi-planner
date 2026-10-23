const assert = require('node:assert/strict');
const { analyze, validate, sample, day } = require('../src/app.js');
const t = (id, s, e, deps = [], extra = {}) => ({
  id,
  name: id,
  start: s,
  end: e,
  owner: '',
  deps,
  lag: 0,
  progress: 0,
  ...extra,
});
const ts = [
  t('A', '2027-01-01', '2027-01-03'),
  t('B', '2027-01-01', '2027-01-02', ['A']),
  t('C', '2027-01-01', '2027-01-01', ['A']),
  t('M', '2027-01-06', '2027-01-06', ['B', 'C'], { milestone: true }),
];
let a = analyze(ts, 'M');
assert.equal(a.es.B, day('2027-01-04'));
assert.equal(a.ef.B, day('2027-01-06'));
assert.equal(a.slack.A, 0);
assert.equal(a.slack.B, 0);
assert.equal(a.slack.C, 1);
assert.equal(a.slack.M, 0);
a = analyze([...ts, t('Z', '2027-03-01', '2027-03-03')], 'M');
assert.equal(a.slack.Z, undefined);
assert.equal(a.finish, day('2027-01-06'));
assert.throws(
  () =>
    analyze([t('A', '2027-01-01', '2027-01-02', ['B']), t('B', '2027-01-01', '2027-01-02', ['A'])]),
  /循環/,
);
assert.throws(() => analyze([t('A', '2027-01-01', '2027-01-02', ['X'])]), /存在しない/);
assert.equal(
  analyze([
    t('A', '2027-01-01', '2027-01-03'),
    t('B', '2027-01-01', '2027-01-01', ['A'], { lag: 2 }),
  ]).es.B,
  day('2027-01-06'),
);
let p = sample();
assert.deepEqual(validate(JSON.parse(JSON.stringify(p))), p);
assert.throws(() => validate({ ...p, tasks: [...p.tasks, p.tasks[0]] }), /重複/);
assert.throws(() => validate({ ...p, tasks: [t('A', '2027-02-30', '2027-03-04')] }), /日付/);
assert.throws(
  () =>
    validate({
      ...p,
      tasks: [t('A', '2027-01-01', '2027-01-03', [], { actualEnd: '2027-01-02' })],
    }),
  /実績開始/,
);
assert.equal(analyze([]).relevant.size, 0);
console.log(
  'PASS: FS, lag, milestone, critical path, target scoping, cycles, missing dependencies, date validation, actual dates, JSON round-trip, empty project',
);

const { rememberOwners } = require('../src/app.js');
const legacy = sample();
delete legacy.owners;
validate(legacy);
assert(legacy.owners.includes('担当A'));
legacy.tasks[0].owner = '追加した担当者';
rememberOwners(legacy);
legacy.tasks[0].owner = '担当A';
rememberOwners(legacy);
assert(legacy.owners.includes('追加した担当者'));
assert.equal(legacy.owners.length, new Set(legacy.owners).size);
assert.deepEqual(validate(JSON.parse(JSON.stringify(legacy))).owners, legacy.owners);
console.log('PASS: legacy owner migration, owner history, deduplication, JSON round-trip');

const { dependencyPoints } = require('../src/app.js');
function intersectsBar(a, b, r) {
  if (a[1] === b[1])
    return (
      a[1] > r.top &&
      a[1] < r.bottom &&
      Math.max(a[0], b[0]) > r.left &&
      Math.min(a[0], b[0]) < r.right
    );
  return (
    a[0] > r.left &&
    a[0] < r.right &&
    Math.max(a[1], b[1]) > r.top &&
    Math.min(a[1], b[1]) < r.bottom
  );
}
for (const [from, to, sourceRow, targetRow] of [
  [180, 180, 0, 1],
  [180, 180, 1, 0],
  [220, 160, 0, 1],
  [220, 160, 1, 0],
  [180, 190, 0, 1],
  [180, 240, 0, 1],
]) {
  const points = dependencyPoints(from, to, sourceRow, targetRow);
  const end = points.at(-1),
    prev = points.at(-2);
  assert(end[0] > prev[0]);
  assert.equal(end[1], prev[1]);
  const bars = [
    { left: from - 100, right: from, top: sourceRow * 64 + 14, bottom: sourceRow * 64 + 39 },
    { left: to, right: to + 100, top: targetRow * 64 + 14, bottom: targetRow * 64 + 39 },
  ];
  for (let i = 1; i < points.length; i++) {
    assert(points[i][0] === points[i - 1][0] || points[i][1] === points[i - 1][1]);
    for (const bar of bars)
      assert(
        !intersectsBar(points[i - 1], points[i], bar),
        'dependency must go around both task bars',
      );
  }
}
console.log(
  'PASS: dependency routing at equal boundaries, overlapping dates, narrow gaps, reverse row order, right-facing arrowheads, no endpoint-bar intersections',
);

const { duration, taskFinish, progressDay } = require('../src/app.js');
const weekendExample = [
  t('A', '2026-10-21', '2026-10-25'),
  t('B', '2026-10-26', '2026-10-29', ['A']),
  t('C', '2026-10-26', '2026-10-30', ['A']),
  t('D', '2026-11-01', '2026-11-04', ['B', 'C']),
];
assert.deepEqual(analyze(weekendExample).slack, { A: 1, B: 2, C: 1, D: 0 });
const weekdays = analyze(weekendExample, 'all', true);
assert.deepEqual(weekdays.slack, { A: 0, B: 1, C: 0, D: 0 });
assert.equal(weekdays.es.D, day('2026-11-02'));
assert.equal(weekdays.ef.D, day('2026-11-05'));
assert.deepEqual([...weekdays.criticalDependencies], ['["A","C"]', '["C","D"]']);
assert.equal(analyze(weekendExample, 'B', true).slack.C, undefined);
assert.deepEqual([...analyze(weekendExample, 'B', true).criticalDependencies], ['["A","B"]']);

const fridayTask = t('F', '2026-10-23', '2026-10-23');
const mondayTask = t('N', '2026-10-24', '2026-10-27', ['F']);
const weekendShift = analyze([fridayTask, mondayTask], 'all', true);
assert.equal(weekendShift.ef.F, day('2026-10-24'));
assert.equal(weekendShift.es.N, day('2026-10-26'));
assert.equal(weekendShift.ef.N, day('2026-10-28'));
assert.equal(analyze([fridayTask, { ...mondayTask, lag: 1 }], 'all', true).es.N, day('2026-10-27'));
const weekendMilestone = t('M', '2026-10-25', '2026-10-25', ['F'], { milestone: true });
assert.equal(analyze([fridayTask, weekendMilestone], 'M', true).es.M, day('2026-10-25'));
assert.equal(analyze([fridayTask, weekendMilestone], 'M', true).slack.F, 0);
assert.equal(
  analyze(
    [weekendMilestone, { ...fridayTask, deps: [] }, { ...mondayTask, deps: ['M'] }],
    'all',
    true,
  ).es.N,
  day('2026-10-26'),
);
const longTask = t('L', '2026-10-23', '2026-11-06');
assert.equal(duration(longTask), 15);
assert.equal(duration(longTask, true), 11);
assert.equal(taskFinish(day('2026-10-26'), 11, true), day('2026-11-10'));
assert.equal(duration(t('old', '1969-12-26', '1969-12-29'), true), 2);
const progressTask = t('P', '2026-10-23', '2026-10-27');
assert.equal(progressDay(progressTask, 50, true), day('2026-10-26') + 0.5);
assert.equal(progressDay(progressTask, 50), day('2026-10-25') + 0.5);
assert.equal(progressDay(progressTask, 100, true), day('2026-10-28'));

const weekdayProject = { ...sample(), excludeWeekends: true };
assert.equal(validate(JSON.parse(JSON.stringify(weekdayProject))).excludeWeekends, true);
const oldProject = sample();
assert.equal(validate(oldProject).excludeWeekends, undefined);
assert.deepEqual(analyze(oldProject.tasks).slack, analyze(oldProject.tasks, 'all', false).slack);
assert.throws(() => validate({ ...sample(), excludeWeekends: 'true' }), /設定/);
assert.throws(
  () =>
    validate({ ...sample(), excludeWeekends: true, tasks: [t('W', '2026-10-24', '2026-10-25')] }),
  /平日を1日以上/,
);
console.log(
  'PASS: weekend exclusion, working-day slack and critical arrows, target scoping, weekend starts, lag, weekend milestones, durations, progress, calendar JSON compatibility',
);

const { defaultTarget } = require('../src/app.js');
const milestoneTargets = [
  t('later', '2027-02-01', '2027-02-01', [], { milestone: true }),
  t('past', '2027-01-01', '2027-01-01', [], { milestone: true }),
  t('ordinary', '2027-01-05', '2027-01-05'),
  t('nearest', '2027-01-10', '2027-01-10', [], { milestone: true }),
  t('sameDate', '2027-01-10', '2027-01-10', [], { milestone: true }),
];
assert.equal(defaultTarget(milestoneTargets, '2027-01-04'), 'nearest');
assert.equal(defaultTarget(milestoneTargets, '2027-01-10'), 'nearest');
assert.equal(defaultTarget(milestoneTargets, '2027-01-11'), 'later');
assert.equal(defaultTarget(milestoneTargets, '2027-02-02'), 'all');
assert.equal(defaultTarget([], '2027-01-01'), 'all');
assert.equal(defaultTarget([milestoneTargets[2]], '2027-01-01'), 'all');
console.log(
  'PASS: nearest upcoming milestone, same-day target, stable ties, no upcoming milestones',
);

// Date.parseがコメント扱いで受理する文字列でも、JSONの日付には許可しない。
const baselineInjection = '2026-11-01 ("><img src=x onerror="globalThis.__baselineXss=1">(';
assert(Number.isFinite(day(baselineInjection)));
for (const field of ['start', 'end']) {
  for (const value of [
    baselineInjection,
    '2026-02-30',
    '2026-11-01 (comment)',
    '2026-11-01 ',
    ['2026-11-01'],
    null,
    20261101,
  ]) {
    const project = sample();
    project.baseline.tasks.T01[field] = value;
    assert.throws(() => validate(JSON.parse(JSON.stringify(project))), /基準計画の日付/);
  }
}
for (const tasks of ['invalid', 1, [], null]) {
  assert.throws(() => validate({ ...sample(), baseline: { tasks } }), /基準計画/);
}
for (const baseline of [undefined, null]) {
  const project = { ...sample(), baseline };
  assert.deepEqual(validate(JSON.parse(JSON.stringify(project))).tasks, project.tasks);
}
const leapYearProject = sample();
leapYearProject.baseline.tasks.T01 = { start: '2028-02-29', end: '2028-03-01' };
assert.deepEqual(validate(JSON.parse(JSON.stringify(leapYearProject))), leapYearProject);
console.log(
  'PASS: strict baseline dates, date-parser injection rejection, baseline structure, legacy and leap-year compatibility',
);
