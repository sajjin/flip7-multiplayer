// game.js — Flip 7 game engine

function buildDeck() {
  const deck = [];
  const numberColors = [
    '#909090', '#f94144', '#f3722c', '#f8961e', '#f9c74f', '#90be6d', '#43aa8b',
    '#4d908e', '#577590', '#277da1', '#8e44ad', '#ff6b6b', '#00b4d8'
  ];

  // Number cards (81): one 0, numbers 1..12 repeated by value, plus 2 additional 12s to match 81 total.
  deck.push({ type: 'number', value: 0, color: numberColors[0] });
  for (let n = 1; n <= 12; n++) {
    for (let i = 0; i < n; i++) {
      deck.push({ type: 'number', value: n, color: numberColors[n] });
    }
  }
  deck.push({ type: 'number', value: 12, color: numberColors[12] });
  deck.push({ type: 'number', value: 12, color: numberColors[12] });

  // Modifier cards (6): +2, +4, +6, +8, +10, x2.
  deck.push({ type: 'bonus', value: '+2', points: 2 });
  deck.push({ type: 'bonus', value: '+4', points: 4 });
  deck.push({ type: 'bonus', value: '+6', points: 6 });
  deck.push({ type: 'bonus', value: '+8', points: 8 });
  deck.push({ type: 'bonus', value: '+10', points: 10 });
  deck.push({ type: 'bonus', value: 'x2', multiplier: 2 });

  // Action cards (7): Second Chance, Freeze, Flip 3.
  for (let i = 0; i < 3; i++) deck.push({ type: 'special', value: 'Freeze' });
  for (let i = 0; i < 3; i++) deck.push({ type: 'special', value: 'Flip3' });
  deck.push({ type: 'special', value: '2ndChance' });

  return shuffle(deck);
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function calcScore(player) {
  const base = player.hand.reduce((s, c) => s + c.value, 0) + player.bonusPoints;
  return base * (player.roundMultiplier || 1);
}

function hasDuplicate(player, value) {
  return player.hand.some(c => c.value === value);
}

function createRoom(roomCode, hostName, hostId) {
  return {
    roomCode,
    phase: 'lobby',       // lobby | playing | roundEnd | gameOver
    players: [{
      id: hostId,
      name: hostName,
      hand: [],
      bonusPoints: 0,
      bonusCards: [],
      hasSecondChance: false,
      roundMultiplier: 1,
      passed: false,
      busted: false,
      frozenNextTurn: false,
      flip3PendingDraws: 0,
      drewThisTurn: false,
      totalScore: 0,
      isHost: true,
    }],
    deck: [],
    currentTurn: 0,
    round: 1,
    lastDrawn: null,
    lastDrawSeq: 0,
    lastDrawerId: null,
    lastSpecialChoiceSeq: 0,
    lastSpecialChoiceCard: null,
    lastSpecialChoiceTargetId: null,
    lastMessage: '',
    flip3Pending: 0,       // cards still to draw from Flip3
    pendingFreezeChooserId: null,
    pendingFlip3ChooserId: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

function addPlayer(room, name, id) {
  if (room.phase !== 'lobby') return { error: 'Game already started' };
  if (room.players.length >= 8) return { error: 'Room is full (max 8)' };
  if (room.players.find(p => p.id === id)) return { error: 'Already in room' };
  room.players.push({
    id, name,
    hand: [], bonusPoints: 0,
    bonusCards: [],
    hasSecondChance: false,
    roundMultiplier: 1,
    passed: false, busted: false,
    frozenNextTurn: false,
    flip3PendingDraws: 0,
    drewThisTurn: false,
    totalScore: 0,
    isHost: false,
  });
  room.updatedAt = Date.now();
  return { ok: true };
}

function startGame(room, playerId) {
  const host = room.players.find(p => p.id === playerId);
  if (!host || !host.isHost) return { error: 'Only the host can start' };
  if (room.players.length < 1) return { error: 'Need at least 1 player' };
  room.deck = buildDeck();
  room.phase = 'playing';
  room.currentTurn = 0;
  room.flip3Pending = 0;
  room.lastDrawn = null;
  room.lastDrawSeq = 0;
  room.lastDrawerId = null;
  room.lastSpecialChoiceSeq = 0;
  room.lastSpecialChoiceCard = null;
  room.lastSpecialChoiceTargetId = null;
  room.pendingFreezeChooserId = null;
  room.pendingFlip3ChooserId = null;
  room.players.forEach(p => {
    p.hand = [];
    p.bonusPoints = 0;
    p.bonusCards = [];
    p.hasSecondChance = false;
    p.roundMultiplier = 1;
    p.passed = false;
    p.busted = false;
    p.frozenNextTurn = false;
    p.flip3PendingDraws = 0;
    p.drewThisTurn = false;
  });
  room.lastMessage = `${room.players[0].name}'s turn to draw or pass.`;
  room.updatedAt = Date.now();
  return { ok: true };
}

function drawCard(room, playerId) {
  if (room.phase !== 'playing') return { error: 'Not in playing phase' };
  if (room.pendingFreezeChooserId || room.pendingFlip3ChooserId) return { error: 'Choose a special card target first' };
  const player = room.players[room.currentTurn];
  if (player.id !== playerId) return { error: 'Not your turn' };
  if (player.passed || player.busted) return { error: 'Your turn is over' };
  if (room.flip3Pending === 0 && player.drewThisTurn) return { error: 'You already drew this turn' };

  if (room.deck.length === 0) {
    room.deck = buildDeck();
    room.lastMessage = 'Deck reshuffled!';
  }

  if (room.flip3Pending > 0) {
    room.flip3Pending--;
  }

  player.drewThisTurn = true;
  const card = room.deck.pop();
  room.lastDrawn = card;
  room.lastDrawerId = player.id;
  room.lastDrawSeq = (room.lastDrawSeq || 0) + 1;

  const result = applyCard(room, player, card);

  if (room.phase === 'playing') {
    if (result.event === 'freezePending' || result.event === 'flip3TargetPending') {
      // Wait for player to choose a target.
    } else if (result.event === 'bust' || result.event === 'flip7') {
      // Round flow already handled inside applyCard.
    } else if (room.flip3Pending > 0) {
      room.lastMessage = `${room.lastMessage} ${room.flip3Pending} extra draw(s) remaining.`;
    } else {
      advanceTurn(room);
    }
  }

  room.updatedAt = Date.now();
  return result;
}

function applyCard(room, player, card) {
  if (card.type === 'number') {
    if (hasDuplicate(player, card.value)) {
      if (player.hasSecondChance) {
        player.hasSecondChance = false;
        room.lastMessage = `🛡️ ${player.name} used Second Chance — duplicate ${card.value} discarded!`;
        return { ok: true, event: 'secondChanceUsed' };
      }
      // BUST
      player.hand.push({ ...card, bustDuplicate: true });
      player.busted = true;
      room.lastMessage = `💥 ${player.name} BUSTED drawing duplicate ${card.value}!`;
      checkRoundEnd(room);
      return { ok: true, event: 'bust' };
    } else {
      player.hand.push(card);
      // Check Flip 7
      if (player.hand.length >= 7) {
        const unique = new Set(player.hand.map(c => c.value));
        if (unique.size >= 7) {
          player.bonusPoints += 15;
          room.lastMessage = `🎉 FLIP 7! ${player.name} collected 7 unique cards! +15 bonus!`;
          endRound(room);
          return { ok: true, event: 'flip7' };
        }
      }
      room.lastMessage = `${player.name} drew ${card.value}.`;
      return { ok: true, event: 'drew' };
    }
  } else if (card.type === 'bonus') {
    if (card.multiplier) {
      player.roundMultiplier = (player.roundMultiplier || 1) * card.multiplier;
      room.lastMessage = `✨ ${player.name} drew ${card.value} — hand score is now multiplied by ${player.roundMultiplier}!`;
    } else {
      player.bonusPoints += card.points;
      player.bonusCards = player.bonusCards || [];
      player.bonusCards.push({ value: card.value, points: card.points });
      room.lastMessage = `✨ ${player.name} drew ${card.value} — bonus points!`;
    }
    return { ok: true, event: 'bonus' };
  } else if (card.type === 'special') {
    if (card.value === 'Freeze') {
      const freezeTargets = room.players
        .filter(p => !p.passed && !p.busted)
        .map(p => ({ id: p.id, name: p.name }));

      // If the drawer is the only active player left, auto-freeze self and end turn.
      if (freezeTargets.length <= 1) {
        player.passed = true;
        room.lastMessage = `🧊 Freeze! ${player.name} is the last active player and is frozen out of this round.`;
        checkRoundEnd(room);
        return { ok: true, event: 'freezeAutoSelf' };
      }

      room.pendingFreezeChooserId = player.id;
      room.lastMessage = `🧊 ${player.name} drew Freeze and must choose a target.`;
      return { ok: true, event: 'freezePending', freezeTargets };
    } else if (card.value === 'Flip3') {
      room.pendingFlip3ChooserId = player.id;
      const flip3Targets = room.players
        .filter(p => !p.passed && !p.busted)
        .map(p => ({ id: p.id, name: p.name }));
      room.lastMessage = `🔄 ${player.name} drew Flip 3 and must choose a target.`;
      return { ok: true, event: 'flip3TargetPending', flip3Targets };
    } else if (card.value === '2ndChance') {
      if (player.hasSecondChance) {
        player.hasSecondChance = false;
        player.busted = true;
        room.lastMessage = `💥 ${player.name} BUSTED by drawing a second Second Chance card!`;
        checkRoundEnd(room);
        return { ok: true, event: 'bust' };
      }
      player.hasSecondChance = true;
      room.lastMessage = `🛡️ ${player.name} has Second Chance protection!`;
      return { ok: true, event: 'secondChance' };
    }
  }
  return { ok: true, event: 'drew' };
}

function passPlayer(room, playerId) {
  if (room.phase !== 'playing') return { error: 'Not in playing phase' };
  if (room.pendingFreezeChooserId || room.pendingFlip3ChooserId) return { error: 'Choose a special card target first' };
  const player = room.players[room.currentTurn];
  if (player.id !== playerId) return { error: 'Not your turn' };
  if (player.passed || player.busted) return { error: 'Already done' };
  if (room.flip3Pending > 0) return { error: 'Must finish drawing Flip 3 cards' };

  player.passed = true;
  room.lastMessage = `${player.name} locked in with ${calcScore(player)} points.`;

  checkRoundEnd(room);
  room.updatedAt = Date.now();
  return { ok: true };
}

function advanceTurn(room) {
  let next = (room.currentTurn + 1) % room.players.length;
  let loops = 0;
  while ((room.players[next].passed || room.players[next].busted) && loops <= room.players.length) {
    next = (next + 1) % room.players.length;
    loops++;
  }
  if (loops > room.players.length) {
    endRound(room);
    return;
  }
  room.currentTurn = next;
  const p = room.players[next];
  p.drewThisTurn = false;
  room.flip3Pending = p.flip3PendingDraws || 0;
  p.flip3PendingDraws = 0;
  if (p.frozenNextTurn) {
    p.frozenNextTurn = false;
    room.lastMessage = `🧊 ${p.name}'s turn is frozen! Skipping.`;
    advanceTurn(room);
    return;
  }
  room.lastMessage = room.flip3Pending > 0
    ? `🔄 ${p.name}'s turn — must draw ${room.flip3Pending} extra card(s).`
    : `${p.name}'s turn — draw or pass.`;
}

function checkRoundEnd(room) {
  const active = room.players.filter(p => !p.passed && !p.busted);
  if (active.length === 0) {
    endRound(room);
    return true;
  }
  advanceTurn(room);
  return false;
}

function endRound(room) {
  // Award round scores
  room.players.forEach(p => {
    if (!p.busted) p.totalScore += calcScore(p);
  });

  const WINNING_SCORE = 200;
  const winners = room.players.filter(p => p.totalScore >= WINNING_SCORE);
  if (winners.length > 0) {
    room.phase = 'gameOver';
    const winner = winners.sort((a, b) => b.totalScore - a.totalScore)[0];
    room.lastMessage = `🏆 ${winner.name} wins the game with ${winner.totalScore} points!`;
    return;
  }

  room.phase = 'roundEnd';
  const roundWinner = room.players.filter(p => !p.busted)
    .sort((a, b) => calcScore(b) - calcScore(a))[0];
  room.lastMessage = roundWinner
    ? `Round ${room.round} over! ${roundWinner.name} had the best round.`
    : `Round ${room.round} over — everyone busted!`;
}

function nextRound(room, playerId) {
  const host = room.players.find(p => p.id === playerId);
  if (!host || !host.isHost) return { error: 'Only host can advance rounds' };
  if (room.phase !== 'roundEnd') return { error: 'Not at round end' };

  room.round++;
  // Keep the same deck across rounds; reshuffle only when it reaches 0 while drawing.
  room.lastDrawn = null;
  room.lastDrawSeq = 0;
  room.lastDrawerId = null;
  room.lastSpecialChoiceSeq = 0;
  room.lastSpecialChoiceCard = null;
  room.lastSpecialChoiceTargetId = null;
  room.flip3Pending = 0;
  room.pendingFreezeChooserId = null;
  room.pendingFlip3ChooserId = null;
  // Rotate who goes first
  const firstIdx = room.round % room.players.length;
  room.players.forEach((p, i) => {
    p.hand = [];
    p.bonusPoints = 0;
    p.bonusCards = [];
    p.hasSecondChance = false;
    p.roundMultiplier = 1;
    p.passed = false;
    p.busted = false;
    p.frozenNextTurn = false;
    p.flip3PendingDraws = 0;
    p.drewThisTurn = false;
  });
  room.currentTurn = firstIdx;
  room.phase = 'playing';
  room.lastMessage = `Round ${room.round} — ${room.players[firstIdx].name} goes first.`;
  room.updatedAt = Date.now();
  return { ok: true };
}

function chooseFreezeTarget(room, chooserId, targetId) {
  if (room.phase !== 'playing') return { error: 'Not in playing phase' };
  if (!room.pendingFreezeChooserId) return { error: 'No Freeze target is pending' };
  if (room.pendingFreezeChooserId !== chooserId) return { error: 'Only the Freeze player can choose a target' };

  const chooser = room.players[room.currentTurn];
  if (!chooser || chooser.id !== chooserId) return { error: 'Not your turn' };

  const target = room.players.find(p => p.id === targetId);
  if (!target) return { error: 'Target player not found' };
  if (target.passed || target.busted) return { error: 'Target has already busted or locked in' };

  // Freeze ends the chosen target's round; chooser only ends if self-targeted.
  if (target.id === chooser.id) {
    chooser.passed = true;
  }
  target.passed = true;
  target.flip3PendingDraws = 0;
  target.frozenNextTurn = false;
  room.pendingFreezeChooserId = null;
  room.lastSpecialChoiceSeq = (room.lastSpecialChoiceSeq || 0) + 1;
  room.lastSpecialChoiceCard = 'Freeze';
  room.lastSpecialChoiceTargetId = target.id;
  const freezeMessage = target.id === chooser.id
    ? `🧊 Freeze! ${chooser.name} froze themselves out of this round (${calcScore(chooser)} pts locked).`
    : `🧊 Freeze! ${chooser.name} froze ${target.name} out of this round (${calcScore(target)} pts locked).`;
  room.lastMessage = freezeMessage;

  if (room.phase === 'playing') {
    if (chooser.passed) {
      room.flip3Pending = 0;
      checkRoundEnd(room);
      if (room.phase === 'playing') {
        room.lastMessage = `${freezeMessage} ${room.lastMessage}`;
      }
    } else if (room.flip3Pending > 0) {
      room.lastMessage = `${freezeMessage} ${chooser.name} must still draw ${room.flip3Pending} extra card(s).`;
    } else {
      advanceTurn(room);
      room.lastMessage = `${freezeMessage} ${room.lastMessage}`;
    }
  }

  room.updatedAt = Date.now();
  return { ok: true };
}

function chooseFlip3Target(room, chooserId, targetId) {
  if (room.phase !== 'playing') return { error: 'Not in playing phase' };
  if (!room.pendingFlip3ChooserId) return { error: 'No Flip 3 target is pending' };
  if (room.pendingFlip3ChooserId !== chooserId) return { error: 'Only the Flip 3 player can choose a target' };

  const chooser = room.players[room.currentTurn];
  if (!chooser || chooser.id !== chooserId) return { error: 'Not your turn' };

  const target = room.players.find(p => p.id === targetId);
  if (!target) return { error: 'Target player not found' };
  if (target.passed || target.busted) return { error: 'Target has already busted or locked in' };

  room.pendingFlip3ChooserId = null;
  room.lastSpecialChoiceSeq = (room.lastSpecialChoiceSeq || 0) + 1;
  room.lastSpecialChoiceCard = 'Flip3';
  room.lastSpecialChoiceTargetId = target.id;

  if (target.id === chooser.id) {
    room.flip3Pending += 3;
    room.lastMessage = `🔄 Flip 3! ${chooser.name} chose themselves and must draw ${room.flip3Pending} extra card(s).`;
  } else {
    target.flip3PendingDraws = (target.flip3PendingDraws || 0) + 3;
    room.lastMessage = `🔄 Flip 3! ${chooser.name} chose ${target.name}. ${target.name} now has ${target.flip3PendingDraws} extra draw(s) queued for their turn.`;
  }

  if (room.phase === 'playing' && room.flip3Pending === 0) {
    advanceTurn(room);
  }

  room.updatedAt = Date.now();
  return { ok: true };
}

function endGameByHost(room, playerId) {
  const host = room.players.find(p => p.id === playerId);
  if (!host || !host.isHost) return { error: 'Only host can end game' };
  if (room.phase === 'gameOver') return { error: 'Game is already over' };

  room.phase = 'gameOver';
  room.pendingFreezeChooserId = null;
  room.pendingFlip3ChooserId = null;
  room.flip3Pending = 0;

  const winner = [...room.players].sort((a, b) => b.totalScore - a.totalScore)[0];
  room.lastMessage = winner
    ? `🛑 Game ended by host. ${winner.name} leads with ${winner.totalScore} points.`
    : '🛑 Game ended by host.';
  room.updatedAt = Date.now();
  return { ok: true };
}

function closeLobbyByHost(room, playerId) {
  const host = room.players.find(p => p.id === playerId);
  if (!host || !host.isHost) return { error: 'Only host can close lobby' };
  if (room.phase !== 'lobby') return { error: 'Lobby can only be closed before the game starts' };
  return { ok: true };
}

function removePlayer(room, playerId) {
  const idx = room.players.findIndex(p => p.id === playerId);
  if (idx === -1) return;
  const wasHost = room.players[idx].isHost;
  room.players.splice(idx, 1);
  if (room.pendingFreezeChooserId === playerId) {
    room.pendingFreezeChooserId = null;
  }
  if (room.pendingFlip3ChooserId === playerId) {
    room.pendingFlip3ChooserId = null;
  }
  if (wasHost && room.players.length > 0) {
    room.players[0].isHost = true;
  }
  if (room.phase === 'playing') {
    if (room.currentTurn >= room.players.length) {
      room.currentTurn = 0;
    }
    checkRoundEnd(room);
  }
  room.updatedAt = Date.now();
}

module.exports = {
  createRoom, addPlayer, startGame,
  drawCard, passPlayer, nextRound,
  chooseFreezeTarget,
  chooseFlip3Target,
  endGameByHost,
  closeLobbyByHost,
  removePlayer, calcScore, buildDeck,
};
