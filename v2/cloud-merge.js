(() => {
  "use strict";

  const stable = value => value === undefined ? null : JSON.stringify(value);
  const same = (a, b) => stable(a) === stable(b);

  // A game wallet is an immutable earning/spending ledger. Merge only when
  // one side is unchanged from the last common baseline or starts empty.
  // Never sum balances or choose a winner for concurrent wallet changes.
  function walletCore(game) {
    if (!game) return null;
    const energy = game.energy && game.energy.value !== 5 ? game.energy : null;
    return { grants: game.grants, purchases: game.purchases || [],
      equipped: game.equipped || { scarf: false, glasses: false, theme: "default", victory: "default" },
      energy };
  }
  const sameWallet = (a, b) => same(walletCore(a), walletCore(b));
  const emptyWallet = value => !value || (!value.grants.length && !(value.purchases || []).length &&
    (!value.energy || value.energy.value === 5));
  function containsBaseOperations(candidate, base) {
    if (!base || (!base.grants?.length && !(base.purchases || []).length)) return true;
    if (!candidate) return false;
    // Economic operations are immutable. No valid edit removes old grants or
    // purchases, even when some newer operations remain in the wallet.
    const grants = new Map((candidate.grants || []).map(g => [g.key, JSON.stringify(g)]));
    const purchases = new Map((candidate.purchases || []).map(p => [p.id, JSON.stringify(p)]));
    return (base.grants || []).every(g => grants.get(g.key) === JSON.stringify(g)) &&
      (base.purchases || []).every(p => purchases.get(p.id) === JSON.stringify(p));
  }
  function mergeWallet(local, remote, base) {
    if (!local && !remote) return { game: null, conflict: false };
    // A v1 client overwriting a synced v2 snapshot is a destructive downgrade.
    if (base && (!containsBaseOperations(local, base) ||
      !containsBaseOperations(remote, base))) {
      return { game: null, conflict: true }; // An immutable ledger cannot lose existing operations.
    }
    let selected;
    if (!local) selected = remote;
    else if (!remote) selected = local;
    else if (sameWallet(local, remote)) selected = local;
    else if (base && sameWallet(local, base)) selected = remote;
    else if (base && sameWallet(remote, base)) selected = local;
    else if (emptyWallet(local)) selected = remote;
    else if (emptyWallet(remote)) selected = local;
    else return { game: null, conflict: true };

    if (!selected) return { game: null, conflict: false };
    const excluded = [...new Set([...(local?.excludedIds || []),
      ...(remote?.excludedIds || []), ...(base?.excludedIds || [])])].sort();
    return { game: { ...selected, excludedIds: excluded }, conflict: false };
  }

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
    const wallet = mergeWallet(local.game || null, remote.game || null, base?.game || null);
    if (wallet.conflict) conflicts.push({ id: "game-wallet", type: "wallet" });
    return { tasks, achievements, game: wallet.game, conflicts };
  }

  function sameSnapshot(a, b) {
    return same(a.tasks, b.tasks) && same(a.achievements, b.achievements) &&
      sameWallet(a.game || null, b.game || null) &&
      same((a.game?.excludedIds || []).slice().sort(), (b.game?.excludedIds || []).slice().sort());
  }

  window.sdelanoSyncMerge = Object.freeze({ merge, sameSnapshot, mergeWallet });
})();
