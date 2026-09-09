import { findRoute, describeRoute } from './graph.js';
import { CATEGORIES, PLAN_SCALE } from '../data/floorplans.js';

const el = (id) => document.getElementById(id);

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function highlightMatch(text, query) {
  if (!query) return escapeHtml(text);
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`(${escaped})`, 'gi');
  return escapeHtml(text).replace(regex, '<span class="highlight">$1</span>');
}

/**
 * Owns the Directions tab: origin picker, route drawing in 3D,
 * and entrance comparisons.
 */
export function setupDirections(app) {
  const { campus, graph, routeLayer } = app;

  const dom = {
    origin: el('origin'),
    originClear: el('origin-clear'),
    originResults: el('origin-results'),
    dest: el('dest'),
    destClear: el('dest-clear'),
    destResults: el('dest-results'),
    swapBtn: el('btn-swap-route'),
    stepFree: el('step-free'),
    routePanel: el('route-panel'),
    routeSummary: el('route-summary'),
    steps: el('steps'),
    entrancesPanel: el('entrances-panel'),
    entrances: el('entrances'),
    empty: el('directions-empty'),
    restartBtn: el('restart-directions'),
  };

  const state = {
    destination: null, // room
    origin: null, // { id, label, sublabel }
    stepFree: false,
    activeEntranceId: null,
  };

  const destinations = campus.rooms
    .filter((room) => room.category !== 'circulation' || /entrance|lobby|foyer/i.test(room.name))
    .map((room) => ({
      room,
      haystack:
        `${room.name} ${room.code ?? ''} ${room.note ?? ''} ${room.building.name} ${room.level.name}`.toLowerCase(),
    }));

  const allRooms = campus.rooms.map((room) => ({
    room,
    haystack:
      `${room.name} ${room.code ?? ''} ${room.note ?? ''} ${room.building.name} ${room.level.name}`.toLowerCase(),
  }));

  // ------------------------------------------------------------ searching

  attachSearch(dom.dest, dom.destResults, destinations, (room) => {
    state.destination = room;
    if (dom.dest) dom.dest.value = label(room);
    if (dom.destClear) dom.destClear.hidden = false;
    recompute({ frame: true });
  });

  attachSearch(dom.origin, dom.originResults, allRooms, (room) => {
    state.origin = {
      id: room.navNode,
      label: label(room),
      sublabel: `${room.building.name} · ${room.level.name}`,
    };
    if (dom.origin) dom.origin.value = label(room);
    if (dom.originClear) dom.originClear.hidden = false;
    recompute({ frame: true });
  });

  // Clear buttons
  dom.origin?.addEventListener('input', () => {
    if (dom.originClear) dom.originClear.hidden = !dom.origin.value;
  });
  dom.dest?.addEventListener('input', () => {
    if (dom.destClear) dom.destClear.hidden = !dom.dest.value;
  });

  dom.originClear?.addEventListener('click', () => {
    dom.origin.value = '';
    state.origin = null;
    dom.originClear.hidden = true;
    if (dom.originResults) dom.originResults.hidden = true;
    recompute({ frame: false });
  });

  dom.destClear?.addEventListener('click', () => {
    dom.dest.value = '';
    state.destination = null;
    dom.destClear.hidden = true;
    if (dom.destResults) dom.destResults.hidden = true;
    recompute({ frame: false });
  });

  // Swap origin & destination
  dom.swapBtn?.addEventListener('click', () => {
    const prevDest = state.destination;
    const prevOrigin = state.origin;

    if (!prevDest && !prevOrigin) return;

    let newDest = null;
    if (prevOrigin) {
      newDest = campus.rooms.find((r) => r.navNode === prevOrigin.id) || null;
    }

    let newOrigin = null;
    if (prevDest) {
      newOrigin = {
        id: prevDest.navNode,
        label: label(prevDest),
        sublabel: `${prevDest.building.name} · ${prevDest.level.name}`,
      };
    }

    state.destination = newDest;
    state.origin = newOrigin;

    if (dom.dest) dom.dest.value = newDest ? label(newDest) : '';
    if (dom.origin) dom.origin.value = newOrigin ? newOrigin.label : '';

    if (dom.destClear) dom.destClear.hidden = !dom.dest.value;
    if (dom.originClear) dom.originClear.hidden = !dom.origin.value;

    recompute({ frame: true });
  });

  function attachSearch(input, list, index, onPick) {
    if (!input || !list) return;

    const run = () => {
      const query = input.value.trim().toLowerCase();
      if (!query) {
        list.hidden = true;
        return;
      }
      const matches = index.filter((entry) => entry.haystack.includes(query)).slice(0, 10);
      list.replaceChildren();
      list.hidden = false;

      if (!matches.length) {
        const li = document.createElement('li');
        li.className = 'empty';
        li.innerHTML = `<span class="empty-icon">🔍</span><span>No rooms found for "<strong>${escapeHtml(query)}</strong>"</span>`;
        list.append(li);
        return;
      }

      for (const { room } of matches) {
        const li = document.createElement('li');
        const highlightedName = highlightMatch(room.name, query);
        const codeHtml = room.code ? `<span class="code-pill">${escapeHtml(room.code)}</span>` : '';
        const dotColor = (CATEGORIES[room.category]?.color ?? 0x1b2a4a).toString(16).padStart(6, '0');

        li.innerHTML =
          `<span class="dot" style="background:#${dotColor}"></span>` +
          `<span class="name">${highlightedName}</span>` +
          codeHtml +
          `<span class="where">${room.building.name.replace('Block ', '')} · ${room.level.name.replace('Level ', 'L')}</span>`;

        li.addEventListener('click', () => {
          list.hidden = true;
          onPick(room);
        });
        list.append(li);
      }
    };

    input.addEventListener('input', run);
    input.addEventListener('focus', run);
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') list.hidden = true;
      if (event.key === 'Enter') list.querySelector('li:not(.empty)')?.click();
    });
  }

  document.addEventListener('click', (event) => {
    if (!event.target.closest('.search')) {
      if (dom.destResults) dom.destResults.hidden = true;
      if (dom.originResults) dom.originResults.hidden = true;
    }
  });

  if (dom.restartBtn) {
    dom.restartBtn.addEventListener('click', () => {
      clearRoute();
      document.dispatchEvent(new CustomEvent('directions-restarted'));
    });
  }

  dom.stepFree?.addEventListener('change', (event) => {
    state.stepFree = event.target.checked;
    recompute({ frame: false });
  });

  // ------------------------------------------------------------ routing

  function recompute({ frame }) {
    const destination = state.destination;

    if (!destination) {
      routeLayer.clear();
      dom.routePanel.hidden = true;
      dom.entrancesPanel.hidden = true;
      dom.empty.hidden = false;
      if (dom.restartBtn) dom.restartBtn.hidden = true;
      if (app.onRouteCleared) app.onRouteCleared();
      return;
    }

    dom.empty.hidden = true;
    if (dom.restartBtn) dom.restartBtn.hidden = false;
    const goal = destination.navNode;

    // Every entrance, ranked.
    const options = graph.entrances
      .map((entrance) => ({
        entrance,
        route: findRoute(graph, entrance.id, goal, { stepFree: state.stepFree }),
      }))
      .filter((option) => option.route)
      .sort((a, b) => a.route.seconds - b.route.seconds);

    renderEntrances(options, frame);

    const originId = state.origin?.id ?? options[0]?.entrance.id ?? null;
    if (!originId) {
      dom.routePanel.hidden = true;
      dom.routeSummary.textContent = '';
      routeLayer.clear();
      return;
    }

    if (!state.origin) {
      state.activeEntranceId = originId;
    }

    drawRoute(originId, goal, frame);
  }

  function drawRoute(originId, goalId, frame) {
    const route = findRoute(graph, originId, goalId, { stepFree: state.stepFree });
    const origin = graph.nodes.get(originId);
    const startLabel = state.origin?.id === originId ? state.origin.label : origin.name;
    const endLabel = label(state.destination);

    if (!route) {
      dom.routePanel.hidden = false;
      dom.routeSummary.innerHTML = `<span>No ${
        state.stepFree ? 'step-free ' : ''
      }route found between these two points.</span>`;
      dom.steps.replaceChildren();
      routeLayer.clear();
      if (app.onRouteCleared) app.onRouteCleared();
      return;
    }

    routeLayer.show(route, { startLabel, endLabel });

    dom.routePanel.hidden = false;
    const minutes = Math.max(1, Math.round(route.seconds / 60));
    dom.routeSummary.innerHTML =
      `<strong>${minutes} min</strong>` +
      `<span>· ${Math.round(route.metres)} m` +
      (route.levelChanges
        ? ` · ${route.levelChanges} ${route.levelChanges === 1 ? 'floor change' : 'floor changes'}`
        : ' · same floor') +
      `</span>` +
      (state.stepFree ? '<span class="warn">Step-free route (lifts only)</span>' : '');

    renderSteps(describeRoute(route));

    if (app.onRouteShown) {
      app.onRouteShown(route, { frame });
    }
  }

  function renderSteps(steps) {
    dom.steps.replaceChildren();
    for (const step of steps) {
      const li = document.createElement('li');
      li.textContent = step.text;
      if (step.icon) li.dataset.icon = step.icon;
      dom.steps.append(li);
    }
  }

  function renderEntrances(options, frame) {
    dom.entrancesPanel.hidden = options.length === 0;
    dom.entrances.replaceChildren();

    for (let i = 0; i < options.length; i++) {
      const { entrance, route } = options[i];
      const li = document.createElement('li');
      const button = document.createElement('button');
      const active =
        !state.origin &&
        (state.activeEntranceId ? state.activeEntranceId === entrance.id : i === 0);

      if (active) button.className = 'is-active';
      const minutes = Math.max(1, Math.round(route.seconds / 60));

      button.innerHTML =
        `<span class="rank">${i + 1}</span>` +
        `<span class="name">${entrance.name}<small>${entrance.levelName}</small></span>` +
        `<span class="cost">${minutes} min<small>${Math.round(route.metres)} m</small></span>`;

      button.addEventListener('click', () => {
        state.origin = null;
        state.activeEntranceId = entrance.id;
        if (dom.origin) dom.origin.value = '';
        if (dom.originClear) dom.originClear.hidden = true;
        recompute({ frame: true });
      });

      li.append(button);
      dom.entrances.append(li);
    }
  }

  function label(room) {
    return room.code ? `${room.name} (${room.code})` : room.name;
  }

  function clearRoute() {
    state.destination = null;
    if (dom.dest) dom.dest.value = '';
    if (dom.destClear) dom.destClear.hidden = true;
    state.origin = null;
    if (dom.origin) dom.origin.value = '';
    if (dom.originClear) dom.originClear.hidden = true;
    recompute({ frame: false });
  }

  return {
    setDestination(room) {
      state.destination = room;
      if (dom.dest) dom.dest.value = label(room);
      if (dom.destClear) dom.destClear.hidden = false;
      recompute({ frame: true });
    },
    clear: clearRoute,
    refresh() {
      recompute({ frame: false });
    },
    hasRoute() {
      return Boolean(state.destination);
    },
    destroy() {},
  };
}
