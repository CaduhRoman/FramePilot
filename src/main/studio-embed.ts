/**
 * Runs inside the Remotion Studio frame. It does not change Studio or the project:
 * in clean mode it shows only the composition canvas, and it lets FramePilot's own
 * transport read the position and play, pause or seek through Studio's timeline.
 * Studio internals are read defensively; if anything is missing it reports `ready: false`
 * and leaves Studio untouched, so errors and the full UI stay reachable.
 */
export const STUDIO_EMBED = String.raw`(() => {
  if (window.__framepilotEmbed) return;
  window.__framepilotEmbed = true;
  const style = document.createElement('style');
  style.textContent = 'html.fp-clean body{visibility:hidden!important}'
    + 'html.fp-clean [data-fp-stage],html.fp-clean [data-fp-stage] *{visibility:visible!important}'
    + 'html.fp-clean [data-fp-stage]{position:fixed!important;inset:0!important;z-index:2147483646!important;background:#000!important;pointer-events:none!important}';
  document.head.appendChild(style);
  let clean = true, building = false, last = '';
  const post = message => window.parent.postMessage(Object.assign({fp: 'studio'}, message), '*');
  const fiberOf = node => {
    const key = node && Object.keys(node).find(k => k.startsWith('__reactFiber$'));
    return key ? node[key] : null;
  };
  function inspect() {
    const container = document.querySelector('.remotion-studio-composition-container');
    let fiber = fiberOf(container), timeline = null, manager = null, resolved = null;
    while (fiber) {
      const value = fiber.memoizedProps && fiber.memoizedProps.value;
      if (value && typeof value === 'object') {
        if (!timeline && value.frameRef && typeof value.setPlaying === 'function' && typeof value.isPlaying === 'function') timeline = value;
        if (!manager && Array.isArray(value.compositions) && value.canvasContent !== undefined) manager = value;
        if (!resolved && !Array.isArray(value) && Object.values(value).some(v => v && v.type === 'success' && v.result && typeof v.result.durationInFrames === 'number')) resolved = value;
      }
      fiber = fiber.return;
    }
    const id = manager && manager.canvasContent && manager.canvasContent.type === 'composition' ? manager.canvasContent.compositionId : null;
    let duration = 0, fps = 0;
    const result = id && resolved && resolved[id] && resolved[id].type === 'success' ? resolved[id].result : null;
    const comp = id && manager ? manager.compositions.find(c => c.id === id) : null;
    if (result) {duration = result.durationInFrames; fps = result.fps;}
    else if (comp) {duration = comp.durationInFrames || 0; fps = comp.fps || 0;}
    return {container, timeline, id, duration, fps};
  }
  function wrapBuildHooks() {
    for (const [name, value] of [['remotion_isBuilding', true], ['remotion_finishedBuilding', false]]) {
      const original = window[name];
      if (typeof original === 'function' && !original.__fp) {
        const wrapped = function () {building = value; tick(); return original.apply(this, arguments);};
        wrapped.__fp = true;
        window[name] = wrapped;
      }
    }
  }
  function tick() {
    wrapBuildHooks();
    const info = inspect();
    // Studio sizes the composition from the canvas wrapper (container > canvas > wrapper), so that is the stage.
    const canvas = info.container && info.container.parentElement;
    const stage = canvas && canvas.parentElement && canvas.parentElement !== document.body ? canvas.parentElement : canvas;
    document.querySelectorAll('[data-fp-stage]').forEach(el => {if (el !== stage) el.removeAttribute('data-fp-stage');});
    if (stage) stage.setAttribute('data-fp-stage', '');
    const isolated = clean && Boolean(stage && info.timeline);
    if (document.documentElement.classList.contains('fp-clean') !== isolated) {
      document.documentElement.classList.toggle('fp-clean', isolated);
      // Studio measures its canvas on resize; refit the composition to the new stage size.
      requestAnimationFrame(() => window.dispatchEvent(new Event('resize')));
    }
    const ready = Boolean(stage && info.timeline && info.id);
    const frame = ready ? (info.timeline.frameRef.current[info.id] || 0) : 0;
    const state = {type: 'state', ready, frame, playing: ready ? info.timeline.isPlaying() : false, duration: info.duration, fps: info.fps, building};
    const key = JSON.stringify(state);
    if (key !== last) {last = key; post(state);}
  }
  function seek(frame) {
    const info = inspect();
    if (!info.timeline || !info.id) return;
    const target = Math.max(0, Math.min(Math.round(frame), Math.max(0, info.duration - 1)));
    const update = state => Object.assign({}, state, {[info.id]: target});
    if (info.timeline.seek && typeof info.timeline.seek.seekFrame === 'function') info.timeline.seek.seekFrame(update);
    else info.timeline.setFrameWithoutSeek(update);
  }
  function toggle() {
    const info = inspect();
    if (!info.timeline) return;
    const before = info.timeline.isPlaying();
    // Studio's own Space shortcut also starts audio; fall back to the timeline state if it is ignored.
    document.body.dispatchEvent(new KeyboardEvent('keydown', {key: ' ', code: 'Space', bubbles: true, cancelable: true}));
    document.body.dispatchEvent(new KeyboardEvent('keyup', {key: ' ', code: 'Space', bubbles: true, cancelable: true}));
    setTimeout(() => {const now = inspect().timeline; if (now && now.isPlaying() === before) now.setPlaying(!before);}, 200);
  }
  window.addEventListener('message', event => {
    if (event.source !== window.parent || !event.data || event.data.fp !== 'host') return;
    const data = event.data;
    if (data.type === 'mode') {clean = Boolean(data.clean); last = ''; tick();}
    if (data.type === 'toggle') toggle();
    if (data.type === 'seek' && Number.isFinite(data.frame)) seek(data.frame);
  });
  setInterval(tick, 100);
  post({type: 'hello'});
  tick();
})();`;
