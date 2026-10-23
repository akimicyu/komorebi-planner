'use strict';

// 日付と表示に共通する処理。
const MILLISECONDS_PER_DAY = 86_400_000;

// タイムゾーンによる日付のずれを避けるため、計算にはUTCの日数を使う。
function toDayNumber(dateString) {
  return Math.round(Date.parse(dateString + 'T00:00:00Z') / MILLISECONDS_PER_DAY);
}

function toDateString(dayNumber) {
  return new Date(dayNumber * MILLISECONDS_PER_DAY).toISOString().slice(0, 10);
}

function isValidDateString(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const dayNumber = toDayNumber(value);
  return Number.isFinite(dayNumber) && toDateString(dayNumber) === value;
}

// 「今日」の表示は利用者のローカル日付に合わせる。
function getTodayDate() {
  const currentDate = new Date();
  const year = currentDate.getFullYear();
  const month = String(currentDate.getMonth() + 1).padStart(2, '0');
  const day = String(currentDate.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function escapeHtml(value) {
  const entities = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '\"': '&quot;', "'": '&#39;' };
  return String(value ?? '').replace(/[&<>"']/g, (character) => entities[character]);
}

// 月曜（1970-01-05）を起点に、土日を同じ作業日の境界へ写す。
function toScheduleDay(dayNumber, excludeWeekends = false) {
  if (!excludeWeekends) {
    return dayNumber;
  }
  const daysFromMonday = dayNumber - 4;
  const weeks = Math.floor(daysFromMonday / 7);
  const weekday = daysFromMonday - weeks * 7;
  return weeks * 5 + Math.min(weekday, 5);
}

function fromScheduleDay(scheduleDay, excludeWeekends = false) {
  if (!excludeWeekends) {
    return scheduleDay;
  }
  const weeks = Math.floor(scheduleDay / 5);
  return 4 + weeks * 7 + (scheduleDay - weeks * 5);
}

function getTaskDuration(task, excludeWeekends = false) {
  return task.milestone
    ? 0
    : toScheduleDay(toDayNumber(task.end) + 1, excludeWeekends) -
        toScheduleDay(toDayNumber(task.start), excludeWeekends);
}

function getTaskFinish(startDay, duration, excludeWeekends = false) {
  if (duration === 0) {
    return startDay;
  }
  // 金曜までの作業の完了境界は土曜。休日のマイルストーンも指定できる。
  return (
    fromScheduleDay(toScheduleDay(startDay, excludeWeekends) + duration - 1, excludeWeekends) + 1
  );
}

function getProgressDay(task, progress, excludeWeekends = false) {
  const startDay = toDayNumber(task.start);
  if (task.milestone) {
    return startDay;
  }
  if (progress === 100) {
    return toDayNumber(task.end) + 1;
  }
  const completedDays = (getTaskDuration(task, excludeWeekends) * progress) / 100;
  const wholeDays = Math.floor(completedDays);
  return (
    fromScheduleDay(toScheduleDay(startDay, excludeWeekends) + wholeDays, excludeWeekends) +
    completedDays -
    wholeDays
  );
}

function getDefaultTarget(tasks, statusDate) {
  let nearestMilestone;
  for (const task of tasks) {
    if (
      task.milestone &&
      task.start >= statusDate &&
      (!nearestMilestone || task.start < nearestMilestone.start)
    ) {
      nearestMilestone = task;
    }
  }
  return nearestMilestone?.id || 'all';
}

// 矢印は後続バーの左側へ右向きに入れる。近すぎる場合は行間へ回り込む。
function getDependencyPoints(sourceX, targetX, sourceRow, targetRow, rowHeight = 64) {
  const sourceY = sourceRow * rowHeight + 26;
  const targetY = targetRow * rowHeight + 26;
  const routingGap = 14;
  if (targetX - sourceX >= routingGap * 2) {
    const bendX = (sourceX + targetX) / 2;
    return [
      [sourceX, sourceY],
      [bendX, sourceY],
      [bendX, targetY],
      [targetX, targetY],
    ];
  }
  const corridorY =
    targetRow > sourceRow ? (sourceRow + 1) * rowHeight - 2 : sourceRow * rowHeight + 4;
  return [
    [sourceX, sourceY],
    [sourceX + routingGap, sourceY],
    [sourceX + routingGap, corridorY],
    [targetX - routingGap, corridorY],
    [targetX - routingGap, targetY],
    [targetX, targetY],
  ];
}
// 先行順で最早日、後続順で最遅日を計算し、その差を総余裕とする。
function analyzeSchedule(tasks, target = 'all', excludeWeekends = false) {
  const tasksById = new Map(tasks.map((task) => [task.id, task]));
  const taskOrder = [];
  const visitedTaskIds = new Set();
  const activeTaskIds = new Set();
  function visitTask(task) {
    if (activeTaskIds.has(task.id)) {
      throw Error('依存関係が循環しています：' + task.name);
    }
    if (visitedTaskIds.has(task.id)) {
      return;
    }
    activeTaskIds.add(task.id);
    for (const predecessorId of task.deps) {
      if (!tasksById.has(predecessorId)) {
        throw Error('存在しない先行ID：' + predecessorId);
      }
      visitTask(tasksById.get(predecessorId));
    }
    activeTaskIds.delete(task.id);
    visitedTaskIds.add(task.id);
    taskOrder.push(task);
  }
  // 依存関係の循環を検出しながら、先行タスクが先に来る順序を作る。
  tasks.forEach(visitTask);
  const earliestStarts = {};
  const earliestFinishes = {};
  const latestStarts = {};
  const latestFinishes = {};
  const relevantTaskIds = new Set();
  function collectPredecessors(id) {
    if (relevantTaskIds.has(id)) {
      return;
    }
    relevantTaskIds.add(id);
    tasksById.get(id).deps.forEach(collectPredecessors);
  }
  if (target !== 'all' && tasksById.has(target)) {
    collectPredecessors(target);
  } else {
    tasks.forEach((task) => relevantTaskIds.add(task.id));
  }
  // 通常タスクの終了は、終了日の翌日を表す排他的な境界。
  for (const task of taskOrder) {
    const duration = getTaskDuration(task, excludeWeekends);
    if (!task.milestone && duration < 1) {
      throw Error(`「${task.name}」の計画期間には平日を1日以上含めてください`);
    }
    const earliestDay = Math.max(
      toDayNumber(task.start),
      ...task.deps.map((predecessorId) => {
        const finishDay = earliestFinishes[predecessorId];
        return task.lag
          ? fromScheduleDay(toScheduleDay(finishDay, excludeWeekends) + task.lag, excludeWeekends)
          : finishDay;
      }),
    );
    earliestStarts[task.id] = task.milestone
      ? earliestDay
      : fromScheduleDay(toScheduleDay(earliestDay, excludeWeekends), excludeWeekends);
    earliestFinishes[task.id] = getTaskFinish(earliestStarts[task.id], duration, excludeWeekends);
  }
  const finish = relevantTaskIds.size
    ? Math.max(...[...relevantTaskIds].map((id) => earliestFinishes[id]))
    : toDayNumber(getTodayDate());
  for (const task of [...taskOrder].reverse()) {
    if (!relevantTaskIds.has(task.id)) {
      continue;
    }
    const successors = tasks.filter(
      (successor) => relevantTaskIds.has(successor.id) && successor.deps.includes(task.id),
    );
    latestFinishes[task.id] = successors.length
      ? Math.min(
          ...successors.map((successor) => latestStarts[successor.id] - (successor.lag || 0)),
        )
      : toScheduleDay(finish, excludeWeekends);
    latestStarts[task.id] = latestFinishes[task.id] - getTaskDuration(task, excludeWeekends);
  }
  const slack = {};
  for (const id of relevantTaskIds) {
    slack[id] = latestStarts[id] - toScheduleDay(earliestStarts[id], excludeWeekends);
  }
  const criticalDependencies = new Set();
  for (const task of taskOrder) {
    for (const predecessorId of task.deps) {
      if (
        slack[task.id] === 0 &&
        slack[predecessorId] === 0 &&
        toScheduleDay(earliestStarts[task.id], excludeWeekends) ===
          toScheduleDay(earliestFinishes[predecessorId], excludeWeekends) + (task.lag || 0)
      ) {
        criticalDependencies.add(JSON.stringify([predecessorId, task.id]));
      }
    }
  }
  return {
    order: taskOrder,
    es: earliestStarts,
    ef: earliestFinishes,
    slack,
    relevant: relevantTaskIds,
    finish,
    criticalDependencies,
  };
}
// 担当を外した名前も履歴として残し、同じプロジェクトで再利用する。
function rememberProjectOwners(project) {
  project.owners = [
    ...new Set(
      [...(project.owners || []), ...project.tasks.map((task) => task.owner)]
        .filter((name) => typeof name === 'string')
        .map((name) => name.trim())
        .filter(Boolean),
    ),
  ];
  return project;
}
// 旧形式も読み込めるよう、検証後に担当者候補を補完する。
function validateProject(project) {
  if (
    !project ||
    project.version !== 1 ||
    typeof project.name !== 'string' ||
    !Array.isArray(project.tasks)
  ) {
    throw Error('このツールのJSONファイルを選んでください');
  }
  if (
    project.owners !== undefined &&
    (!Array.isArray(project.owners) ||
      project.owners.length > 5000 ||
      !project.owners.every((n) => typeof n === 'string' && n.length <= 100))
  ) {
    throw Error('担当者リストが不正です');
  }
  if (project.tasks.length > 500) {
    throw Error('タスクは500件までです');
  }
  if (project.excludeWeekends !== undefined && typeof project.excludeWeekends !== 'boolean') {
    throw Error('土日を除く設定が不正です');
  }
  if (
    project.targetSelection !== undefined &&
    !['auto', 'manual'].includes(project.targetSelection)
  ) {
    throw Error('目標の選択方法が不正です');
  }
  const ids = new Set();
  for (const task of project.tasks) {
    if (typeof task.id !== 'string' || !task.id.trim() || ids.has(task.id)) {
      throw Error('タスクIDは重複しない文字列にしてください');
    }
    ids.add(task.id);
    if (typeof task.name !== 'string' || !task.name.trim()) {
      throw Error('タスク名が必要です');
    }
    for (const fieldName of ['start', 'end']) {
      if (!isValidDateString(task[fieldName])) {
        throw Error('日付を確認してください');
      }
    }
    if (toDayNumber(task.end) < toDayNumber(task.start)) {
      throw Error('終了日は開始日以降にしてください');
    }
    if (task.milestone && task.start !== task.end) {
      throw Error('マイルストーンは開始日と終了日を同じにしてください');
    }
    if (
      !Array.isArray(task.deps) ||
      !task.deps.every((x) => typeof x === 'string') ||
      new Set(task.deps).size !== task.deps.length
    ) {
      throw Error('先行IDを確認してください');
    }
    if (!Number.isFinite(task.progress) || task.progress < 0 || task.progress > 100) {
      throw Error('進捗は0〜100%です');
    }
    if (!Number.isInteger(task.lag) || task.lag < 0 || task.lag > 365) {
      throw Error('待ち日数は0〜365日です');
    }
    for (const fieldName of ['actualStart', 'actualEnd']) {
      if (task[fieldName] && !isValidDateString(task[fieldName])) {
        throw Error('実績日を確認してください');
      }
    }
    if (task.actualEnd && !task.actualStart) {
      throw Error('実績終了日には実績開始日も必要です');
    }
    if (task.actualEnd && task.actualEnd < task.actualStart) {
      throw Error('実績終了日は実績開始日以降です');
    }
    if (task.actualEnd && task.progress !== 100) {
      throw Error('実績終了日を入れる場合は進捗を100%にしてください');
    }
  }
  if (project.statusDate && !isValidDateString(project.statusDate)) {
    throw Error('基準日が不正です');
  }
  if (
    project.tasks.length &&
    Math.max(...project.tasks.map((task) => toDayNumber(task.end))) -
      Math.min(...project.tasks.map((task) => toDayNumber(task.start))) >
      3660
  ) {
    throw Error('計画範囲は10年以内にしてください');
  }
  analyzeSchedule(project.tasks, 'all', project.excludeWeekends);
  if (project.baseline) {
    if (
      typeof project.baseline !== 'object' ||
      !project.baseline.tasks ||
      typeof project.baseline.tasks !== 'object' ||
      Array.isArray(project.baseline.tasks)
    ) {
      throw Error('基準計画が不正です');
    }
    for (const baseline of Object.values(project.baseline.tasks)) {
      if (
        !baseline ||
        !isValidDateString(baseline.start) ||
        !isValidDateString(baseline.end) ||
        toDayNumber(baseline.end) < toDayNumber(baseline.start)
      ) {
        throw Error('基準計画の日付が不正です');
      }
    }
  }
  return rememberProjectOwners(project);
}
// 外部ファイルは読まず、ここから講演会サンプルを生成する。
function createSampleProject() {
  const rows = [
    ['T01', '実行委員会キックオフ・全体方針策定', '2026-11-01', '2026-11-15', '担当A', [], 100],
    ['T02', '開催要項・予算案策定', '2026-11-16', '2026-12-15', '担当B', ['T01'], 60],
    ['T03', '会場選定・設備確認・仮予約', '2026-12-01', '2026-12-28', '担当C', ['T01'], 30],
    [
      'T04',
      '特別講演講師・来賓への登壇依頼',
      '2027-01-05',
      '2027-01-31',
      '担当D',
      ['T02', 'T03'],
      0,
    ],
    ['T05', '案内状送付・参加受付開始', '2027-02-01', '2027-02-28', '担当E', ['T04'], 0],
    ['T06', '記念品・ノベルティの手配', '2027-02-15', '2027-03-15', '担当F', ['T02'], 0],
    ['T07', '参加者名簿確定・参加費集計', '2027-03-16', '2027-04-10', '担当G', ['T05'], 0],
    ['T08', '当日配布資料・パンフレット印刷', '2027-04-01', '2027-04-25', '担当H', ['T04'], 0],
    ['T09', '進行台本策定・司会リハーサル', '2027-04-26', '2027-05-10', '担当I', ['T08'], 0],
    ['T10', '合格祝賀CPD 開催', '2027-05-16', '2027-05-16', '全員', ['T06', 'T07', 'T09'], 0],
    ['T11', '終了報告・アンケート集計', '2027-05-17', '2027-05-31', '担当A', ['T10'], 0],
  ];
  const actualStarts = {
    T01: '2026-11-01',
    T02: '2026-11-18',
    T03: '2026-12-03',
  };
  const tasks = rows.map(([id, name, start, end, owner, deps, progress]) => ({
    id,
    name,
    start,
    end,
    owner,
    deps,
    progress,
    lag: 0,
    milestone: id === 'T10',
    actualStart: actualStarts[id] || '',
    actualEnd: id === 'T01' ? '2026-11-15' : '',
    note: '',
  }));
  return {
    version: 1,
    name: '講演会準備（サンプル）',
    tasks,
    owners: [...new Set(tasks.map((task) => task.owner))],
    baseline: {
      savedAt: '2026-11-01',
      tasks: Object.fromEntries(
        tasks.map((task) => [
          task.id,
          { start: task.start, end: task.end, milestone: task.milestone },
        ]),
      ),
    },
    statusDate: '2026-12-10',
  };
}
if (typeof module !== 'undefined') {
  module.exports = {
    day: toDayNumber,
    date: toDateString,
    duration: getTaskDuration,
    analyze: analyzeSchedule,
    validate: validateProject,
    sample: createSampleProject,
    rememberOwners: rememberProjectOwners,
    dependencyPoints: getDependencyPoints,
    progressDay: getProgressDay,
    taskFinish: getTaskFinish,
    defaultTarget: getDefaultTarget,
  };
}
// ブラウザ内の状態と操作。Node.jsのテストでは初期化しない。
function initializeApp() {
  const $ = (id) => document.getElementById(id);
  const STORAGE_KEY = 'komorebi-gantt-v1';
  let project;
  let hasUnsavedChanges = false;
  let editingTaskId = null;
  let projectFileHandle = null;
  const viewOptions = {
    scale: 0,
    baseline: true,
    actual: true,
    lightning: true,
    deps: true,
    critical: true,
  };
  try {
    project = validateProject(JSON.parse(localStorage.getItem(STORAGE_KEY)));
  } catch {
    project = createSampleProject();
  }

  function toast(message) {
    $('toast').textContent = message;
    $('toast').classList.add('show');
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => $('toast').classList.remove('show'), 4500);
  }
  // 自動保存はブラウザ内だけ。共有用JSONへの保存はsaveProjectFileで行う。
  function persist() {
    rememberProjectOwners(project);
    hasUnsavedChanges = true;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(project));
      $('saveState').textContent = '端末に自動保存済み · JSON保存で共有';
    } catch {
      $('saveState').textContent = '端末保存できません · JSONを保存してください';
    }
    render();
  }
  // 画面更新の入口。計算・集計・チャート描画を順に呼び出す。
  function render() {
    const target = renderProjectFields();
    let analysis;
    try {
      analysis = analyzeSchedule(project.tasks, target, project.excludeWeekends);
    } catch (error) {
      toast(error.message);
      return;
    }

    renderSummary(analysis);
    if (!project.tasks.length) {
      $('chart').innerHTML = '<div class="empty">タスクを追加して計画を始めましょう。</div>';
      return;
    }

    const layout = createChartLayout();
    const rows = project.tasks
      .map((task, index) => renderTaskRow(task, index, analysis, layout))
      .join('');
    const chart = `
      <div class="grid ${project.excludeWeekends ? 'weekends-excluded' : ''}" style="width:${layout.leftWidth + layout.chartWidth}px;--day-width:${layout.pixelsPerDay}px;--weekday-width:${layout.pixelsPerDay * 5}px;--week-width:${layout.pixelsPerDay * 7}px;--week-offset:${layout.weekOffset}px">
        ${renderTimelineHeader(layout)}
        ${rows}
      </div>
      <div class="overlaywrap" style="left:${layout.leftWidth}px;top:72px;width:${layout.chartWidth}px;height:${layout.chartHeight}px">
        ${renderChartOverlay(layout, analysis)}
      </div>`;
    $('chart').innerHTML = chart;
    $('note').textContent =
      `目標までの余裕：現在の開始日を「これより前に着手しない日」として計算。灰色の余裕「—」は選択目標の対象外。${project.baseline ? 'イナズマ線は基準計画' : 'イナズマ線は現在計画'}と進捗率から算出。`;
  }

  function renderProjectFields() {
    rememberProjectOwners(project);
    $('ownerCandidates').innerHTML = project.owners
      .map((name) => `<option value="${escapeHtml(name)}"></option>`)
      .join('');
    $('projectName').value = project.name;
    $('statusDate').value = project.statusDate || getTodayDate();
    $('excludeWeekends').checked = !!project.excludeWeekends;
    $('calendarSummary').textContent = project.excludeWeekends
      ? '平日で計算（土日を除く・祝日は含む）'
      : '暦日で計算';

    // 従来の具体的な目標は引き継ぎ、未指定・従来の初期値は自動選択する。
    if (!project.targetSelection) {
      project.targetSelection = project.target && project.target !== 'all' ? 'manual' : 'auto';
    }
    const hasValidTarget =
      project.target === 'all' || project.tasks.some((task) => task.id === project.target);
    if (!hasValidTarget) {
      project.targetSelection = 'auto';
    }
    const target =
      project.targetSelection === 'manual'
        ? project.target
        : getDefaultTarget(project.tasks, $('statusDate').value);
    project.target = target;
    $('target').innerHTML =
      '<option value="all">プロジェクト全体</option>' +
      project.tasks
        .map(
          (task) =>
            `<option value="${escapeHtml(task.id)}">${escapeHtml(task.id + ' ' + task.name)}${task.milestone ? ' ◆' : ''}</option>`,
        )
        .join('');
    $('target').value = target;
    return target;
  }

  function renderSummary(analysis) {
    const incompleteTasks = project.tasks.filter((task) => task.progress < 100);
    const lateTasks = incompleteTasks.filter(
      (task) => toDayNumber(task.end) < toDayNumber($('statusDate').value),
    );
    const criticalTasks = project.tasks.filter((task) => analysis.slack[task.id] === 0);

    $('count').textContent = project.tasks.length;
    $('done').textContent = project.tasks.filter((task) => task.progress === 100).length;
    $('late').textContent = lateTasks.length;
    $('criticalCount').textContent = criticalTasks.filter((task) => task.progress < 100).length;
    $('baselineLabel').textContent = project.baseline
      ? '基準計画：' + project.baseline.savedAt
      : '基準計画：未保存';
  }

  // 日付はUTCの日数、描画位置はピクセル。ここで両者の対応を決める。
  function createChartLayout() {
    const statusDay = toDayNumber($('statusDate').value);
    const allDays = project.tasks.flatMap((task) => [
      toDayNumber(task.start),
      toDayNumber(task.end),
      task.actualStart ? toDayNumber(task.actualStart) : toDayNumber(task.start),
      task.actualEnd ? toDayNumber(task.actualEnd) : toDayNumber(task.end),
    ]);
    if (project.baseline) {
      Object.values(project.baseline.tasks).forEach((baseline) => {
        allDays.push(toDayNumber(baseline.start), toDayNumber(baseline.end));
      });
    }

    let firstDay = Math.min(...allDays) - 7;
    let lastDay = Math.max(...allDays) + 14;
    if (statusDay >= firstDay - 90 && statusDay <= lastDay + 90) {
      firstDay = Math.min(firstDay, statusDay - 3);
      lastDay = Math.max(lastDay, statusDay + 7);
    }

    const leftWidth = 720;
    const rowHeight = 64;
    const dayCount = lastDay - firstDay + 1;
    const pixelsPerDay =
      viewOptions.scale || Math.max(620, $('scroll').clientWidth - leftWidth) / dayCount;
    return {
      firstDay,
      lastDay,
      statusDay,
      leftWidth,
      rowHeight,
      pixelsPerDay,
      weekOffset: -((new Date(firstDay * MILLISECONDS_PER_DAY).getUTCDay() + 6) % 7) * pixelsPerDay,
      chartWidth: dayCount * pixelsPerDay,
      chartHeight: project.tasks.length * rowHeight,
      dateToX: (dayNumber) => (dayNumber - firstDay) * pixelsPerDay,
    };
  }

  function renderTimelineHeader(layout) {
    const { firstDay, lastDay, pixelsPerDay, dateToX, chartWidth } = layout;
    let monthLabels = '';
    let dateLabels = '';
    let previousMonth = '';
    let previousLabelX = -Infinity;

    for (let dayNumber = firstDay; dayNumber <= lastDay; dayNumber++) {
      const calendarDate = new Date(dayNumber * MILLISECONDS_PER_DAY);
      const month = toDateString(dayNumber).slice(0, 7);
      const positionX = dateToX(dayNumber);
      if (month !== previousMonth) {
        if (dayNumber !== firstDay || calendarDate.getUTCDate() < 10) {
          const label = `${calendarDate.getUTCFullYear()}/${String(calendarDate.getUTCMonth() + 1).padStart(2, '0')}`;
          monthLabels += `<span style="left:${positionX}px">${label}</span>`;
        }
        previousMonth = month;
      }

      const isLabelDay =
        pixelsPerDay >= 18 ||
        (pixelsPerDay >= 7 && calendarDate.getUTCDay() === 1) ||
        (pixelsPerDay < 7 && [1, 16].includes(calendarDate.getUTCDate()));
      if (isLabelDay && positionX - previousLabelX >= 52) {
        previousLabelX = positionX;
        dateLabels += `<span style="left:${positionX}px">${calendarDate.getUTCMonth() + 1}/${calendarDate.getUTCDate()}</span>`;
      }
    }

    return `
      <div class="head left">
        <span>タスク / 担当者</span><span>計画期間</span><span>進捗</span><span>余裕</span>
      </div>
      <div class="head timeline" style="width:${chartWidth}px">
        <div class="months">${monthLabels}</div>
        <div class="ticks">${dateLabels}</div>
      </div>`;
  }

  function renderTaskRow(task, index, analysis, layout) {
    const slack = analysis.slack[task.id];
    const isCritical = slack === 0 && viewOptions.critical;
    const hasDependencyConflict = analysis.es[task.id] > toDayNumber(task.start);
    const isWeekendStart =
      project.excludeWeekends &&
      !task.milestone &&
      fromScheduleDay(toScheduleDay(toDayNumber(task.start), true), true) > toDayNumber(task.start);
    const warning = hasDependencyConflict
      ? `<small class="warning">${isWeekendStart ? '開始日を平日へ調整してください' : '先行タスクと日程不整合'}</small>`
      : '';
    const startLabel = task.start.slice(5).replace('-', '/');
    const endLabel = task.end.slice(5).replace('-', '/');

    return `
      <div class="task left ${isCritical ? 'iscritical' : ''}" data-id="${escapeHtml(task.id)}">
        <div class="task-name">
          <div class="task-moves">
            <button type="button" data-move="-1" data-move-id="${escapeHtml(task.id)}" aria-label="${escapeHtml(task.name)}を上へ" ${index === 0 ? 'disabled' : ''}>↑ 上へ</button>
            <button type="button" data-move="1" data-move-id="${escapeHtml(task.id)}" aria-label="${escapeHtml(task.name)}を下へ" ${index === project.tasks.length - 1 ? 'disabled' : ''}>↓ 下へ</button>
          </div>
          <button type="button" class="tasktext">
            <small>${escapeHtml(task.id)} ${task.milestone ? '◆' : ''} · ${escapeHtml(task.owner || '担当未設定')}</small>
            <strong>${escapeHtml(task.name)}</strong>
          </button>
        </div>
        <span class="period">${escapeHtml(startLabel)} → ${escapeHtml(endLabel)}${warning}</span>
        <span class="pct">${task.progress}%</span>
        <span class="slack">${slack === undefined ? '—' : slack + '日'}</span>
      </div>
      <div class="lane" style="width:${layout.chartWidth}px">
        ${renderBaselineBar(task, layout)}
        ${renderPlannedBar(task, isCritical, layout)}
        ${renderActualBar(task, layout)}
      </div>`;
  }

  function renderBaselineBar(task, layout) {
    const baseline = project.baseline?.tasks[task.id];
    if (!viewOptions.baseline || !baseline) {
      return '';
    }

    const duration = baseline.milestone
      ? 0
      : toDayNumber(baseline.end) - toDayNumber(baseline.start) + 1;
    const width = Math.max(4, duration * layout.pixelsPerDay);
    const left = layout.dateToX(toDayNumber(baseline.start));
    return `<div class="base" style="left:${left}px;width:${width}px" title="${escapeHtml(`基準計画 ${baseline.start}〜${baseline.end}`)}"></div>`;
  }

  function renderPlannedBar(task, isCritical, layout) {
    const width = Math.max(8, getTaskDuration(task) * layout.pixelsPerDay);
    const left = layout.dateToX(toDayNumber(task.start));
    const progressWidth =
      task.progress === 0
        ? 0
        : ((getProgressDay(task, task.progress, project.excludeWeekends) -
            toDayNumber(task.start)) /
            Math.max(1, getTaskDuration(task))) *
          100;
    const progress = task.milestone ? '' : `<i style="width:${progressWidth}%"></i>`;
    return `
      <button
        class="bar ${task.milestone ? 'milestone' : ''} ${isCritical ? 'critical' : ''}"
        data-id="${escapeHtml(task.id)}"
        style="left:${left}px;width:${width}px"
        title="${escapeHtml(`${task.name}：${task.start}〜${task.end}`)}"
      >${progress}</button>`;
  }

  function renderActualBar(task, layout) {
    if (!viewOptions.actual || !task.actualStart) {
      return '';
    }

    const startDay = toDayNumber(task.actualStart);
    const endDay = task.actualEnd
      ? toDayNumber(task.actualEnd)
      : Math.max(startDay, layout.statusDay);
    const width = Math.max(4, (endDay - startDay + 1) * layout.pixelsPerDay);
    const left = layout.dateToX(startDay);
    return `<div class="actual" style="left:${left}px;width:${width}px" title="${escapeHtml(`実績 ${task.actualStart}〜${task.actualEnd || '基準日まで（未完了）'}`)}"></div>`;
  }

  function renderDependencyPaths(layout, analysis) {
    if (!viewOptions.deps) {
      return '';
    }

    let paths = '';
    project.tasks.forEach((task, targetRow) => {
      task.deps.forEach((predecessorId) => {
        const sourceRow = project.tasks.findIndex((candidate) => candidate.id === predecessorId);
        const predecessor = project.tasks[sourceRow];
        const sourceX =
          layout.dateToX(toDayNumber(predecessor.start)) +
          (predecessor.milestone
            ? Math.SQRT2 * 8
            : Math.max(8, getTaskDuration(predecessor) * layout.pixelsPerDay));
        const targetX =
          layout.dateToX(toDayNumber(task.start)) - (task.milestone ? Math.SQRT2 * 8 : 0);
        const route = getDependencyPoints(sourceX, targetX, sourceRow, targetRow, layout.rowHeight);
        const path = route
          .map(([positionX, positionY], index) => `${index ? 'L' : 'M'}${positionX},${positionY}`)
          .join(' ');
        const isCritical =
          viewOptions.critical &&
          analysis.criticalDependencies.has(JSON.stringify([predecessorId, task.id]));
        paths += `<path d="${path}" class="dependency${isCritical ? ' critical' : ''}" marker-end="url(#${isCritical ? 'criticalArrow' : 'arrow'})"/>`;
      });
    });
    return paths;
  }

  function renderProgressLine(layout) {
    if (!viewOptions.lightning) {
      return '';
    }

    const points = project.tasks.map((task, rowIndex) => {
      const baseline = project.baseline?.tasks[task.id] || task;
      let progressDay = layout.statusDay;
      if (task.progress < 100 && layout.statusDay >= toDayNumber(baseline.start)) {
        progressDay = getProgressDay(baseline, task.progress, project.excludeWeekends);
      }
      return `${layout.dateToX(progressDay)},${rowIndex * layout.rowHeight + 26}`;
    });
    const statusX = layout.dateToX(layout.statusDay);
    return `<polyline points="${statusX},0 ${points.join(' ')} ${statusX},${layout.chartHeight}" class="lightning"/>`;
  }

  function renderChartOverlay(layout, analysis) {
    const { chartWidth, chartHeight, dateToX, statusDay } = layout;
    const statusX = dateToX(statusDay);
    const statusLine =
      statusX >= 0 && statusX <= chartWidth
        ? `<path d="M${statusX},0 V${chartHeight}" class="todayline"/>`
        : '';
    return `
      <svg class="overlay" width="${chartWidth}" height="${chartHeight}" viewBox="0 0 ${chartWidth} ${chartHeight}">
        <defs>
          <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto">
            <path d="M0 0 L10 5 L0 10" fill="#8c9bac"/>
          </marker>
          <marker id="criticalArrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto">
            <path d="M0 0 L10 5 L0 10" fill="#be5c53"/>
          </marker>
        </defs>
        ${renderDependencyPaths(layout, analysis)}
        ${statusLine}
        ${renderProgressLine(layout)}
      </svg>`;
  }

  function openTask(id = null) {
    editingTaskId = id;
    const task = project.tasks.find((task) => task.id === id) || {
      id:
        'T' +
        String(
          Math.max(0, ...project.tasks.map((task) => Number(task.id.replace(/^T/, '')) || 0)) + 1,
        ).padStart(2, '0'),
      name: '',
      owner: '',
      start: project.statusDate || getTodayDate(),
      end: project.statusDate || getTodayDate(),
      progress: 0,
      deps: [],
      lag: 0,
      milestone: false,
      actualStart: '',
      actualEnd: '',
      note: '',
    };
    $('taskForm').reset();
    for (const key of [
      'id',
      'name',
      'owner',
      'start',
      'end',
      'progress',
      'lag',
      'actualStart',
      'actualEnd',
      'note',
    ]) {
      $('f_' + key).value = task[key] ?? '';
    }
    $('f_milestone').checked = !!task.milestone;
    synchronizeMilestoneDates();
    $('f_deps').innerHTML =
      project.tasks
        .filter((x) => x.id !== id)
        .map(
          (x) =>
            `<label class="depoption"><input type="checkbox" value="${escapeHtml(x.id)}" ${task.deps.includes(x.id) ? 'checked' : ''}><span>${escapeHtml(x.id + ' ' + x.name)}</span></label>`,
        )
        .join('') || '<span class="muted">先行タスクはありません</span>';
    $('deleteTask').hidden = !id;
    $('dialogTitle').textContent = id ? 'タスクを編集' : 'タスクを追加';
    $('formError').textContent = '';
    $('dialog').showModal();
  }

  function moveTask(id, direction) {
    const index = project.tasks.findIndex((task) => task.id === id);
    const destination = index + direction;
    if (
      index < 0 ||
      ![-1, 1].includes(direction) ||
      destination < 0 ||
      destination >= project.tasks.length
    ) {
      return;
    }
    [project.tasks[index], project.tasks[destination]] = [
      project.tasks[destination],
      project.tasks[index],
    ];
    persist();
    const moveButtons = [...$('chart').querySelectorAll('[data-move-id]')].filter(
      (button) => button.dataset.moveId === id && !button.disabled,
    );
    const nextButton =
      moveButtons.find((button) => Number(button.dataset.move) === direction) || moveButtons[0];
    nextButton?.focus({ preventScroll: true });
  }

  function handleChartClick(event) {
    const moveButton = event.target.closest('[data-move]');
    if (moveButton) {
      if (!moveButton.disabled) {
        moveTask(moveButton.dataset.moveId, Number(moveButton.dataset.move));
      }
      return;
    }
    const taskElement = event.target.closest('[data-id]');
    if (taskElement) {
      openTask(taskElement.dataset.id);
    }
  }

  function synchronizeMilestoneDates() {
    const isMilestone = $('f_milestone').checked;
    $('f_end').disabled = isMilestone;
    $('milestoneDateHint').hidden = !isMilestone;
    if (isMilestone) {
      $('f_end').value = $('f_start').value;
    }
  }

  function saveTaskFromForm(event) {
    event.preventDefault();
    try {
      const task = {};
      for (const key of [
        'id',
        'name',
        'owner',
        'start',
        'end',
        'actualStart',
        'actualEnd',
        'note',
      ]) {
        task[key] = $('f_' + key).value.trim();
      }
      task.progress = Number($('f_progress').value);
      task.lag = Number($('f_lag').value);
      task.milestone = $('f_milestone').checked;
      if (task.milestone) {
        task.end = task.start;
      }
      task.deps = [...$('f_deps').querySelectorAll('input:checked')].map(
        (candidate) => candidate.value,
      );
      const updatedProject = structuredClone(project);
      if (editingTaskId) {
        updatedProject.tasks = updatedProject.tasks.map((candidate) =>
          candidate.id === editingTaskId ? task : candidate,
        );
        if (task.id !== editingTaskId) {
          updatedProject.tasks.forEach(
            (candidate) =>
              (candidate.deps = candidate.deps.map((predecessorId) =>
                predecessorId === editingTaskId ? task.id : predecessorId,
              )),
          );
          if (updatedProject.target === editingTaskId) {
            updatedProject.target = task.id;
          }
          if (updatedProject.baseline?.tasks[editingTaskId]) {
            updatedProject.baseline.tasks[task.id] = updatedProject.baseline.tasks[editingTaskId];
            delete updatedProject.baseline.tasks[editingTaskId];
          }
        }
      } else {
        updatedProject.tasks.push(task);
      }
      validateProject(updatedProject);
      project = updatedProject;
      persist();
      $('dialog').close();
    } catch (error) {
      $('formError').textContent = error.message;
    }
  }

  function deleteSelectedTask() {
    const task = project.tasks.find((task) => task.id === editingTaskId);
    const dependentTasks = project.tasks.filter((task) => task.deps.includes(editingTaskId));
    if (
      !confirm(
        `「${task.name}」を削除しますか？${dependentTasks.length ? ' 後続タスクの依存関係からも外れます。' : ''}`,
      )
    ) {
      return;
    }
    project.tasks = project.tasks.filter((task) => task.id !== editingTaskId);
    project.tasks.forEach((task) => (task.deps = task.deps.filter((id) => id !== editingTaskId)));
    persist();
    $('dialog').close();
  }

  function toggleChartExpansion() {
    const expanded = document.body.classList.toggle('chartfocus');
    $('expandChart').textContent = expanded ? '通常表示に戻す' : 'チャートを広く';
    requestAnimationFrame(render);
  }

  let resizeTimer;

  function saveBaseline() {
    if (
      project.baseline &&
      !confirm(
        '現在の基準計画を置き換えます。古い基準計画を残す場合は、先にJSON保存してください。置き換えますか？',
      )
    ) {
      return;
    }
    project.baseline = {
      savedAt: getTodayDate(),
      tasks: Object.fromEntries(
        project.tasks.map((task) => [
          task.id,
          { start: task.start, end: task.end, milestone: task.milestone },
        ]),
      ),
    };
    persist();
    toast('現在の計画を基準計画として保存しました');
  }

  function reschedulePendingTasks() {
    const analysis = analyzeSchedule(project.tasks, 'all', project.excludeWeekends);
    const changed = project.tasks.filter(
      (task) =>
        !task.milestone &&
        analysis.es[task.id] > toDayNumber(task.start) &&
        task.progress === 0 &&
        !task.actualStart,
    );
    if (!changed.length) {
      toast('後ろに移動する未着手の通常タスクはありません。マイルストーンは移動しません');
      return;
    }
    if (
      !confirm(
        `${changed.length}件の未着手タスクを、先行タスクの完了後へ移動します。マイルストーンと着手済みのタスクは動かしません。実行しますか？`,
      )
    ) {
      return;
    }
    for (const task of changed) {
      task.start = toDateString(analysis.es[task.id]);
      task.end = toDateString(analysis.ef[task.id] - 1);
    }
    persist();
    toast('依存関係に合わせて日程を更新しました');
  }

  function changeWorkingCalendar(event) {
    const updatedProject = structuredClone(project);
    updatedProject.excludeWeekends = event.target.checked;
    try {
      validateProject(updatedProject);
      project = updatedProject;
      persist();
      toast('計算方法を変更しました。日付の変更は「依存に合わせて日程調整」で行えます');
    } catch (error) {
      event.target.checked = !!project.excludeWeekends;
      toast(error.message);
    }
  }

  function download(name, content, type) {
    const url = URL.createObjectURL(new Blob([content], { type }));
    const downloadLink = document.createElement('a');
    downloadLink.href = url;
    downloadLink.download = name;
    downloadLink.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function saveProjectFile() {
    try {
      const text = JSON.stringify(project, null, 2);
      if (projectFileHandle) {
        const writable = await projectFileHandle.createWritable();
        await writable.write(text);
        await writable.close();
        toast('開いたJSONファイルへ保存しました');
      } else {
        download(project.name.replace(/[\\/:*?"<>|]/g, '_') + '.json', text, 'application/json');
        toast('JSONを保存しました。共有フォルダに置いて使えます');
      }
      hasUnsavedChanges = false;
    } catch (error) {
      toast('保存できませんでした：' + error.message);
    }
  }
  async function openProjectFile() {
    if (
      hasUnsavedChanges &&
      !confirm(
        'JSONファイルを開くと現在の表示を置き換えます。必要なら先にJSON保存してください。続けますか？',
      )
    ) {
      return;
    }
    if (window.showOpenFilePicker) {
      try {
        const [handle] = await showOpenFilePicker({
          types: [{ description: 'プロジェクトJSON', accept: { 'application/json': ['.json'] } }],
          multiple: false,
        });
        const loadedProject = validateProject(JSON.parse(await (await handle.getFile()).text()));
        project = loadedProject;
        projectFileHandle = handle;
        persist();
        hasUnsavedChanges = false;
        toast('読み込みました。JSON保存で同じファイルに上書きできます');
      } catch (error) {
        if (error.name !== 'AbortError') {
          toast('読込できませんでした：' + error.message);
        }
      }
    } else {
      $('fileInput').click();
    }
  }
  async function loadProjectFromFileInput(event) {
    try {
      const file = event.target.files[0];
      if (!file) {
        return;
      }
      project = validateProject(JSON.parse(await file.text()));
      projectFileHandle = null;
      persist();
      hasUnsavedChanges = false;
      toast('読み込みました');
    } catch (error) {
      toast('読込できませんでした：' + error.message);
    } finally {
      event.target.value = '';
    }
  }

  function startNewProject() {
    if (
      !confirm('新規プロジェクトに切り替えます。現在の内容は先にJSON保存してください。続けますか？')
    ) {
      return;
    }
    project = {
      version: 1,
      name: '新しいプロジェクト',
      tasks: [],
      target: 'all',
      statusDate: getTodayDate(),
      baseline: null,
    };
    projectFileHandle = null;
    persist();
  }

  function loadSampleProject() {
    if (
      !confirm('講演会サンプルに切り替えます。現在の内容は先にJSON保存してください。続けますか？')
    ) {
      return;
    }
    project = createSampleProject();
    projectFileHandle = null;
    persist();
  }

  bindEvents();
  render();

  // DOMイベントの登録はここに集約する。
  function bindEvents() {
    $('chart').onclick = handleChartClick;
    $('taskForm').onsubmit = saveTaskFromForm;
    $('f_milestone').onchange = synchronizeMilestoneDates;
    $('f_start').oninput = synchronizeMilestoneDates;
    $('f_start').onchange = synchronizeMilestoneDates;
    $('deleteTask').onclick = deleteSelectedTask;
    $('expandChart').onclick = toggleChartExpansion;
    window.addEventListener('keydown', (event) => {
      if (
        event.key === 'Escape' &&
        document.body.classList.contains('chartfocus') &&
        !$('dialog').open &&
        !$('helpDialog').open
      ) {
        document.body.classList.remove('chartfocus');
        $('expandChart').textContent = 'チャートを広く';
        render();
      }
    });
    window.addEventListener('resize', () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(render, 100);
    });
    $('closeDialog').onclick = () => $('dialog').close();
    $('addTask').onclick = () => openTask();
    $('projectName').onchange = (event) => {
      project.name = event.target.value.trim() || '新しいプロジェクト';
      persist();
    };
    $('statusDate').onchange = (event) => {
      if (event.target.value) {
        project.statusDate = event.target.value;
        persist();
      }
    };
    $('target').onchange = (event) => {
      project.target = event.target.value;
      project.targetSelection = 'manual';
      persist();
    };
    $('excludeWeekends').onchange = changeWorkingCalendar;
    $('scale').onchange = (event) => {
      viewOptions.scale = Number(event.target.value);
      render();
    };
    for (const optionName of ['baseline', 'actual', 'lightning', 'deps', 'critical']) {
      $('v_' + optionName).onchange = (event) => {
        viewOptions[optionName] = event.target.checked;
        render();
      };
    }
    $('saveBaseline').onclick = saveBaseline;
    $('schedule').onclick = reschedulePendingTasks;
    $('saveFile').onclick = saveProjectFile;
    $('openFile').onclick = openProjectFile;
    $('fileInput').onchange = loadProjectFromFileInput;
    $('newProject').onclick = startNewProject;
    $('loadSample').onclick = loadSampleProject;
    $('print').onclick = () => window.print();
    $('helpButton').onclick = () => $('helpDialog').showModal();
    $('closeHelp').onclick = () => $('helpDialog').close();
    window.addEventListener('beforeunload', (event) => {
      if (hasUnsavedChanges) {
        event.preventDefault();
        event.returnValue = '';
      }
    });
  }
}

if (typeof document !== 'undefined') {
  initializeApp();
}
