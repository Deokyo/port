(() => {
  'use strict';
  const assetBase = new URL('.', document.currentScript.src);
  const t = text => window.portfolioI18n?.t(text) || text;
  const root = document.getElementById('deokyo-radio');
  if (!root) return;
  const player = root.querySelector('.ds-player');
  const tracks = [
    {name: 'Blood Magic — Daniel Deluxe', file: 'blood-magic.mp3', duration: 214.94},
    {name: 'Shattered Memories — Navjaxx, VXLLAIN', file: 'shattered-memories.m4a', duration: 183.79},
    {name: "You Can't Run From Me — Rico Nasty", file: 'you-cant-run-from-me.mp3', duration: 235.86},
    {name: 'I Really Want to Stay at Your House — Rosa Walton', file: 'i-really-want-to-stay-at-your-house.mp3', duration: 246.78}
  ];
  function openingTrack() {
    const key = 'deokyo-radio-opening-v1';
    const files = tracks.map(track => track.file);
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem(key)) || {}; } catch (_) {}
    let remaining = Array.isArray(saved.remaining)
      ? [...new Set(saved.remaining.filter(file => files.includes(file) && file !== saved.last))]
      : [];
    if (!remaining.length) {
      remaining = [...files];
      for (let i = remaining.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [remaining[i], remaining[j]] = [remaining[j], remaining[i]];
      }
      if (remaining[0] === saved.last) {
        const j = 1 + Math.floor(Math.random() * (remaining.length - 1));
        [remaining[0], remaining[j]] = [remaining[j], remaining[0]];
      }
    }
    const first = remaining.shift();
    try { localStorage.setItem(key, JSON.stringify({last: first, remaining})); } catch (_) {}
    return files.indexOf(first);
  }
  const audio = document.createElement('audio');
  audio.preload = 'none';
  audio.hidden = true;
  root.append(audio);
  const state = {track: openingTrack(), position: 0, volume: 5, collapsed: true, loading: false, error: ''};
  let loadedTrack = -1;
  let request = 0;
  let wantsPlay = false;
  let pendingSeek = null;
  audio.volume = state.volume / 100;
  const seek = root.querySelector('.ds-seek');
  const volume = root.querySelector('.ds-volume input');
  const fold = root.querySelector('.ds-fold');
  const mini = root.querySelector('.ds-mini-play');
  function clock(seconds) {
    const n = Math.floor(Math.max(0, seconds || 0));
    return String(Math.floor(n / 60)).padStart(2, '0') + ':' + String(n % 60).padStart(2, '0');
  }
  function duration() {
    return loadedTrack === state.track && Number.isFinite(audio.duration) ? audio.duration : tracks[state.track].duration;
  }
  function render() {
    const playing = !audio.paused && !audio.ended;
    const total = duration();
    player.dataset.playing = String(playing);
    player.dataset.collapsed = String(state.collapsed);
    player.style.setProperty('--ds-progress', (state.position / total * 100) + '%');
    player.style.setProperty('--ds-volume', state.volume + '%');
    const label = root.querySelector('.ds-track');
    label.textContent = tracks[state.track].name;
    label.title = tracks[state.track].name;
    root.querySelector('.ds-demo').textContent = String(state.track + 1).padStart(2, '0') + ' / 04';
    root.querySelector('.ds-clock').textContent = clock(state.position);
    root.querySelector('.ds-total').textContent = clock(total);
    seek.max = String(total);
    seek.value = String(state.position);
    seek.setAttribute('aria-valuetext', clock(state.position) + ' ' + t('de') + ' ' + clock(total));
    volume.value = String(state.volume);
    root.querySelector('.ds-volume output').value = state.volume + '%';
    const status = root.querySelector('.ds-state');
    const text = state.error || (state.loading ? 'Carregando…' : playing ? 'Tocando' : state.position > 0 ? 'Pausado' : 'Parado');
    if (status.textContent !== t(text)) status.textContent = t(text);
    root.querySelector('[data-action="play"]').setAttribute('aria-pressed', String(playing));
    root.querySelector('[data-action="pause"]').setAttribute('aria-pressed', String(!playing && state.position > 0));
    root.querySelector('[data-action="stop"]').setAttribute('aria-pressed', String(!playing && state.position === 0));
    mini.setAttribute('aria-label', t(playing || wantsPlay ? 'Pausar música' : 'Reproduzir música'));
    mini.querySelector('span').textContent = playing ? 'PAUSE' : 'PLAY';
    fold.setAttribute('aria-label', t(state.collapsed ? 'Expandir player' : 'Recolher player'));
    fold.setAttribute('aria-expanded', String(!state.collapsed));
    fold.querySelector('.ds-fold-fallback').textContent = state.collapsed ? '⌃' : '⌄';
    fold.querySelector('svg').style.transform = state.collapsed ? 'rotate(180deg)' : 'none';
  }
  function loadTrack() {
    if (loadedTrack === state.track && !audio.error) return;
    pendingSeek = state.position;
    audio.src = new URL('audio/' + tracks[state.track].file, assetBase).href;
    loadedTrack = state.track;
    audio.load();
  }
  function play() {
    const current = ++request;
    wantsPlay = true;
    state.error = '';
    state.loading = true;
    loadTrack();
    render();
    audio.play().catch(error => {
      if (current !== request) return;
      wantsPlay = false;
      state.loading = false;
      if (error.name === 'NotAllowedError') state.error = 'Toque no play';
      else if (error.name !== 'AbortError') state.error = 'Não foi possível tocar. Tente novamente.';
      render();
    });
  }
  function pause() {
    request++;
    wantsPlay = false;
    state.loading = false;
    audio.pause();
    render();
  }
  function selectTrack(offset, resume = wantsPlay || !audio.paused) {
    pause();
    state.track = (state.track + offset + tracks.length) % tracks.length;
    state.position = 0;
    pendingSeek = null;
    state.error = '';
    // Changing a stopped track does not download it until Play is pressed.
    audio.removeAttribute('src');
    audio.load();
    loadedTrack = -1;
    render();
    if (resume) play();
  }
  function act(action) {
    if (action === 'play') play();
    if (action === 'pause') pause();
    if (action === 'stop') {
      pause();
      state.position = 0;
      pendingSeek = null;
      state.error = '';
      if (audio.readyState > 0) audio.currentTime = 0;
      render();
    }
    if (action === 'next' || action === 'previous') selectTrack(action === 'next' ? 1 : -1);
  }
  root.querySelectorAll('[data-action]').forEach(button => button.addEventListener('click', () => act(button.dataset.action)));
  mini.addEventListener('click', () => act(wantsPlay || !audio.paused ? 'pause' : 'play'));
  fold.addEventListener('click', () => {state.collapsed = !state.collapsed; render();});
  seek.addEventListener('input', event => {
    state.position = Number(event.target.value);
    if (audio.readyState > 0) audio.currentTime = state.position;
    else pendingSeek = state.position;
    render();
  });
  volume.addEventListener('input', event => {
    state.volume = Number(event.target.value);
    audio.volume = state.volume / 100;
    render();
  });
  audio.addEventListener('loadedmetadata', () => {
    if (pendingSeek !== null) {
      audio.currentTime = Math.min(pendingSeek, duration());
      state.position = audio.currentTime;
      pendingSeek = null;
    }
    render();
  });
  audio.addEventListener('timeupdate', () => {
    if (audio.readyState > 0 && pendingSeek === null) state.position = audio.currentTime;
    render();
  });
  audio.addEventListener('playing', () => {state.loading = false; state.error = ''; render();});
  audio.addEventListener('waiting', () => {state.loading = wantsPlay; render();});
  audio.addEventListener('pause', render);
  audio.addEventListener('ended', () => selectTrack(1, true));
  audio.addEventListener('error', () => {
    wantsPlay = false;
    state.loading = false;
    state.error = 'Não foi possível carregar. Tente novamente.';
    render();
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !state.collapsed) {
      state.collapsed = true; render(); fold.focus();
    }
  });
  document.addEventListener('click', event => {
    if (!state.collapsed && !root.contains(event.target)) {state.collapsed = true; render();}
  });
  document.addEventListener('visibilitychange', () => {
    player.style.setProperty('--ds-animation', document.hidden ? 'paused' : 'running');
  });
  document.addEventListener('portfolio:languagechange', render);
  root.hidden = false;
  render();
  play();
})();
