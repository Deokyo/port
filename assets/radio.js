(() => {
  const root = document.getElementById('deokyo-radio');
  if (!root) return;
  const player = root.querySelector('.ds-player');
  const tracks = [{name:'Afterhours — Demo',duration:228},{name:'Neon rain — Demo',duration:196},{name:'Ghost signal — Demo',duration:242}];
  const initial = {track:0,position:0,volume:35,playing:false,collapsed:false,neon:55,rotation:9};
  let state = {...initial};
  let last = performance.now();
  let onScreen = true;
  if ("IntersectionObserver" in window) {
    new IntersectionObserver(entries => {
      onScreen = entries[0].isIntersecting;
      player.style.setProperty("--ds-animation", onScreen && !document.hidden ? "running" : "paused");
    }).observe(root);
  }
  document.addEventListener("visibilitychange", () => {
    last = performance.now();
    player.style.setProperty("--ds-animation", onScreen && !document.hidden ? "running" : "paused");
  });
  function clock(seconds) { const n=Math.floor(seconds); return String(Math.floor(n/60)).padStart(2,'0')+':'+String(n%60).padStart(2,'0'); }
  function render() {
    const track=tracks[state.track];
    player.dataset.playing=String(state.playing); player.dataset.collapsed=String(state.collapsed);
    player.style.setProperty('--ds-glow',String(state.neon/100)); player.style.setProperty('--ds-spin',state.rotation+'s');
    player.style.setProperty('--ds-progress',(state.position/track.duration*100)+'%');player.style.setProperty('--ds-volume',state.volume+'%');
    const label=root.querySelector('.ds-track'); label.textContent=track.name; label.setAttribute('title',track.name);
    root.querySelector('.ds-clock').textContent=clock(state.position);
    root.querySelector('.ds-total').textContent=clock(track.duration);
    const seek=root.querySelector('.ds-seek'); seek.max=String(track.duration); seek.value=String(state.position); seek.setAttribute('aria-valuetext',clock(state.position)+' de '+clock(track.duration));
    root.querySelector('.ds-volume input').value=String(state.volume); root.querySelector('.ds-volume output').value=state.volume+'%';
    const status=root.querySelector('.ds-state'),statusText=state.playing?'Reproduzindo prévia':state.position>0?'Pausado':'Parado'; if(status.textContent!==statusText)status.textContent=statusText;
    root.querySelector('[data-action="play"]').setAttribute('aria-pressed',String(state.playing));
    root.querySelector('[data-action="pause"]').setAttribute('aria-pressed',String(!state.playing && state.position>0));
    root.querySelector('[data-action="stop"]').setAttribute('aria-pressed',String(!state.playing && state.position===0));
    const mini=root.querySelector('.ds-mini-play'); mini.setAttribute('aria-label',state.playing?'Pausar prévia':'Reproduzir prévia'); mini.querySelector('span').textContent=state.playing?'PAUSE':'PLAY';
    const fold=root.querySelector('.ds-fold'); fold.setAttribute('aria-label',state.collapsed?'Expandir player':'Recolher player'); fold.setAttribute('aria-expanded',String(!state.collapsed)); fold.querySelector('.ds-fold-fallback').textContent=state.collapsed?'⌃':'⌄';
    const icon=fold.querySelector('svg'); if(icon) icon.style.transform=state.collapsed?'rotate(180deg)':'none';
  }
  function act(action) {
    if(action==='play') state.playing=true;
    if(action==='pause') state.playing=false;
    if(action==='stop') {state.playing=false;state.position=0;}
    if(action==='next'||action==='previous') {state.track=(state.track+(action==='next'?1:2))%tracks.length;state.position=0;}
    last=performance.now();render();
  }
  root.querySelectorAll('[data-action]').forEach(button=>button.addEventListener('click',()=>act(button.dataset.action)));
  root.querySelector('.ds-mini-play').addEventListener('click',()=>act(state.playing?'pause':'play'));
  root.querySelector('.ds-fold').addEventListener('click',()=>{state.collapsed=!state.collapsed;render();});
  root.querySelector('.ds-seek').addEventListener('input',event=>{state.position=Number(event.target.value);last=performance.now();render();});
  root.querySelector('.ds-volume input').addEventListener('input',event=>{state.volume=Number(event.target.value);render();});
  root.hidden = false;
  render();
  const timer=setInterval(()=>{
    if(!root.isConnected){clearInterval(timer);return;}
    const now=performance.now(),delta=Math.min(1,(now-last)/1000);last=now;
    if(!state.playing||document.hidden||!onScreen)return;
    state.position+=delta;
    if(state.position>=tracks[state.track].duration){state.track=(state.track+1)%tracks.length;state.position=0;}
    render();
  },250);

})();
