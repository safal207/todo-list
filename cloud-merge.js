(() => {
  "use strict";

  const stable = value => value === undefined ? null : JSON.stringify(value);
  const same = (a, b) => stable(a) === stable(b);

  // Compare current device, cloud and their last confirmed common baseline.
  // If both sides change a task differently, do not choose a winner automatically.
  function merge(local, remote, base = null) {
    const localMap = new Map(local.tasks.map(item => [item.id, item]));
    const remoteMap = new Map(remote.tasks.map(item => [item.id, item]));
    const baseMap = new Map((base?.tasks ?? []).map(item => [item.id, item]));
    const ids = new Set([...localMap.keys(), ...remoteMap.keys(), ...baseMap.keys()]);
    const tasks = [];
    const conflicts = [];
    for (const id of ids) {
      const a = localMap.get(id), b = remoteMap.get(id), old = baseMap.get(id);
      let next;
      if (same(a, b)) next = a;
      else if (base && same(a, old)) next = b;
      else if (base && same(b, old)) next = a;
      else if (!base && a === undefined) next = b;
      else if (!base && b === undefined) next = a;
      else {
        conflicts.push({ id, localTitle: a?.title ?? null, remoteTitle: b?.title ?? null });
        continue;
      }
      if (next) tasks.push(next);
    }
    const achievements = {
      firstWin: local.achievements.firstWin || remote.achievements.firstWin,
      threeSteps: local.achievements.threeSteps || remote.achievements.threeSteps,
      record: Math.max(local.achievements.record, remote.achievements.record)
    };
    return { tasks, achievements, conflicts };
  }

  function sameSnapshot(a, b) {
    return same(a.tasks, b.tasks) && same(a.achievements, b.achievements);
  }

  window.sdelanoSyncMerge = Object.freeze({ merge, sameSnapshot });
})();
