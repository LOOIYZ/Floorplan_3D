import { findRoute, describeRoute } from './graph.js';
import { CATEGORIES, PLAN_SCALE } from '../data/floorplans.js';

const el = (id) => document.getElementById(id);

/**
 * Owns the Directions tab: origin picker, the route drawn in the model
 * and the entrance-by-entrance comparison.
 */
export function setupDirections(app) {
  const { campus, graph, routeLayer } = app;

  const dom = {
    origin: el('origin'),
    originResults: el('origin-results'),
    dest: el('dest'),
    destResults: el('dest-results'),
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
        `${room.name} ${room.code ?? ''} ${room.building.name} ${room.level.name}`.toLowerCase(),
    }));

  const allRooms = campus.rooms.map((room) => ({
    room,
    haystack:
      `${room.name} ${room.code ?? ''} ${room.building.name} ${room.level.name}`.toLowerCase(),
  }));

  // ------------------------------------------------------------ searching

  attachSearch(dom.dest, dom.destResults, destinations, (room) => {
    state.destination = room;
    if (dom.dest) dom.dest.value = label(room);
    recompute({ frame: true });
  });

  attachSearch(dom.origin, dom.originResults, allRooms, (room) => {
    state.origin = {
      id: room.navNode,
      label: label(room),
      sublabel: `${room.building.name} · ${room.level.name}`,
    };
    dom.origin.value = label(room);
    recompute({ frame: true });
  });

  function attachSearch(input, list, index, onPick) {
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
        li.textContent = 'No rooms found';
        list.append(li);
        return;
      }

      for (const { room } of matches) {
        const li = document.createElement('li');
        li.innerHTML =
          `<span class="dot" style="background:#${CATEGORIES[room.category].color
            .toString(16)
            .padStart(6, '0')}"></span>` +
          `<span>${label(room)}</span>` +
          `<span class="where">${room.building.name.replace('Block ', '')} · ${room.level.name.replace(
            'Level ',
            'L',
          )}</span>`;
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
      // Dispatch a custom event so main.js knows to switch back to the explore tab
      document.dispatchEvent(new CustomEvent('directions-restarted'));
    });
  }

  dom.stepFree.addEventListener('change', (event) => {
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
      return;
    }

    routeLayer.show(route, { startLabel, endLabel });

    dom.routePanel.hidden = false;
    const minutes = Math.max(1, Math.round(route.seconds / 60));
    dom.routeSummary.innerHTML =
      `<strong>${minutes} min</strong>` +
      `<span>· ${Math.round(route.metres)} m` +
      (route.levelChanges
        ? ` · ${route.levelChanges} level change${route.levelChanges > 1 ? 's' : ''}`
        : '') +
      `</span>` +
      (state.origin?.sublabel ? `<span class="warn">From ${state.origin.sublabel}.</span>` : '');

    dom.steps.replaceChildren();
    for (const step of describeRoute(route, { startLabel, endLabel })) {
      const li = document.createElement('li');
      li.dataset.icon = step.icon;
      li.textContent = step.text;
      dom.steps.append(li);
    }

    app.onRouteShown(route, { frame });
  }

  function renderEntrances(options, frame) {
    dom.entrancesPanel.hidden = options.length === 0;
    dom.entrances.replaceChildren();

    options.forEach(({ entrance, route }, index) => {
      const li = document.createElement('li');
      const button = document.createElement('button');
      button.className = entrance.id === state.activeEntranceId ? 'is-active' : '';
      const minutes = Math.max(1, Math.round(route.seconds / 60));
      const [block, doorway = ''] = entrance.name.split(' · ');
      button.innerHTML =
        `<span class="rank">${index + 1}</span>` +
        `<span class="name">${doorway || block}<small>${doorway ? block : ''}</small></span>` +
        `<span class="cost">${minutes} min<small>${Math.round(route.metres)} m</small></span>`;
      button.addEventListener('click', () => {
        state.origin = null;
        state.activeEntranceId = entrance.id;
        dom.origin.value = '';
        renderEntrances(options, false);
        drawRoute(entrance.id, state.destination.navNode, true);
      });
      li.append(button);
      dom.entrances.append(li);
    });
  }

  function label(room) {
    return room.code ? `${room.name} (${room.code})` : room.name;
  }

  function clearRoute() {
    state.destination = null;
    if (dom.dest) dom.dest.value = '';
    state.origin = null;
    if (dom.origin) dom.origin.value = '';
    recompute({ frame: false });
  }

  return {
    /** Called from the Explore tab so "Directions to here" works on any room. */
    setDestination(room) {
      state.destination = room;
      if (dom.dest) dom.dest.value = label(room);
      recompute({ frame: true });
    },
    clear: clearRoute,
    refresh() {
      recompute({ frame: false });
    },
    hasRoute() {
      return Boolean(state.destination);
    },
    destroy() {
      // no-op now that GPS tracking is removed
    },
  };
}
