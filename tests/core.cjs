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
