// ═══════════════════════════════════════════════════════════
// VOID INTERCEPTOR — arcade space shooter (canvas 2D)
// Sci-fi drones/ships only. No blood, no realistic violence.
// ═══════════════════════════════════════════════════════════

let gameLoopId = null;

// Shared difficulty tuning used across all games. Higher = harder.
// Easy is intentionally much gentler than before: slower enemies, tougher player enemies (more HP
// needed to threaten the player), and noticeably fewer things spawning at once.
function getDifficultyConfig(difficulty) {
  const presets = {
    easy:    { spawnMult: 0.5,  speedMult: 0.55, hpMult: 0.55, enemyDamageMult: 0.45, label: 'Easy' },
    hard:    { spawnMult: 1.15, speedMult: 1.15, hpMult: 1.25, enemyDamageMult: 1.15, label: 'Hard' },
    hardest: { spawnMult: 1.5,  speedMult: 1.4,  hpMult: 1.6,  enemyDamageMult: 1.4, label: 'Hardest' }
  };
  return presets[difficulty] || presets.easy;
}

// ── SHARED LEVEL SYSTEM ─────────────────────────────────────
// A "level" is a discrete milestone derived from score (every game reports level via a simple
// score threshold — see LEVEL_SCORE_STEP), independent from the continuous wave/distance ramps
// each game already has. Crossing a threshold shows a brief "LEVEL UP!" banner via
// triggerLevelUp(), drawn on top of the game canvas by drawLevelUpBanner().
const LEVEL_SCORE_STEP = 300; // every 300 points = one level, in every game, for a consistent feel
let _levelUpBanner = { timer: 0, level: 0 };

function levelForScore(score) {
  return 1 + Math.floor(Math.max(0, score) / LEVEL_SCORE_STEP);
}

// Call this each frame with the current score and the state's last-seen level; it updates the
// state's level field in place and pops the banner the instant a new level is crossed.
function updateLevel(state, scoreField='score') {
  const newLevel = levelForScore(state[scoreField]);
  if (newLevel > (state.level || 1)) {
    state.level = newLevel;
    _levelUpBanner.timer = 110; // ~1.8s at 60fps
    _levelUpBanner.level = newLevel;
    playBeep(880, 0.12, 'sine', 0.06);
    playBeep(1100, 0.15, 'sine', 0.06);
  } else if (!state.level) {
    state.level = newLevel;
  }
}

function drawLevelUpBanner(ctx, W, H) {
  if (_levelUpBanner.timer <= 0) return;
  _levelUpBanner.timer--;
  const t = _levelUpBanner.timer;
  const fadeIn = Math.min(1, (110 - t) / 15);
  const fadeOut = Math.min(1, t / 20);
  const alpha = Math.min(fadeIn, fadeOut);
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(0,0,0,.55)';
  ctx.fillRect(W/2 - 140, H/2 - 46, 280, 70);
  ctx.strokeStyle = '#f5c518'; ctx.lineWidth = 2;
  ctx.strokeRect(W/2 - 140, H/2 - 46, 280, 70);
  ctx.fillStyle = '#f5c518';
  ctx.font = 'bold 22px sans-serif';
 ctx.fillText(' LEVEL ' + _levelUpBanner.level + '!', W/2, H/2 - 10);
  ctx.fillStyle = '#fff';
  ctx.font = '13px sans-serif';
  ctx.fillText('Keep going!', W/2, H/2 + 14);
  ctx.restore();
}

let sfxCtx = null;

function playBeep(freq, dur, type='square', vol=0.05) {
  try {
    if (!sfxCtx) sfxCtx = new (window.AudioContext||window.webkitAudioContext)();
    const osc = sfxCtx.createOscillator();
    const gain = sfxCtx.createGain();
    osc.type = type; osc.frequency.value = freq;
    gain.gain.value = vol;
    osc.connect(gain); gain.connect(sfxCtx.destination);
    osc.start();
    gain.gain.exponentialRampToValueAtTime(0.001, sfxCtx.currentTime + dur);
    osc.stop(sfxCtx.currentTime + dur);
  } catch {}
}

let _activeListeners = []; // {target, type, fn} registered by the currently running game, cleaned up on stop

function addGameListener(target, type, fn, opts) {
  target.addEventListener(type, fn, opts);
  _activeListeners.push({ target, type, fn, opts });
}

function stopGameLoop() {
  if (gameLoopId) { cancelAnimationFrame(gameLoopId); gameLoopId = null; }
  _levelUpBanner = { timer: 0, level: 0 };
  window.removeEventListener('mousemove', shooterMouseMove);
  window.removeEventListener('mousedown', shooterMouseDown);
  window.removeEventListener('mouseup', shooterMouseUp);
  window.removeEventListener('touchmove', shooterTouchMove);
  window.removeEventListener('touchstart', shooterTouchStart);
  window.removeEventListener('touchend', shooterTouchEnd);
  _activeListeners.forEach(({target,type,fn,opts}) => target.removeEventListener(type, fn, opts));
  _activeListeners = [];
}

let SH = null; // shooter state, scoped per game session

function startSpaceShooter(battleCode, difficulty) {
  const canvas = document.getElementById('gameCanvas');
  const ctx = canvas.getContext('2d');
  const W = canvas.width, Hc = canvas.height;
  const DIFF = getDifficultyConfig(difficulty);

  SH = {
    battleCode,
    player: { x: W/2, y: Hc-70, w: 44, h: 44, speed: 9, cooldown: 0, hp: 3, maxHp: 3, invuln: 0 },
    bullets: [], enemyBullets: [], enemies: [], particles: [], stars: [], nebulae: [], powerups: [],
    score: 0, wave: 1, waveTimer: 0, spawnTimer: 0, autoFire: true,
    firing: false, mouseX: W/2, mouseY: Hc-70, gameOver: false, elapsed: 0,
    bossActive: false, shake: 0,
    weapon: 'single', weaponTimer: 0, // 'single' | 'spread' | 'rapid'
    shieldActive: 0, combo: 0, comboTimer: 0, level: 1,
    diff: DIFF
  };

  for (let i=0;i<90;i++) SH.stars.push({x:Math.random()*W,y:Math.random()*Hc,s:Math.random()*2+0.5,sp:Math.random()*2+0.5});
  for (let i=0;i<4;i++) SH.nebulae.push({x:Math.random()*W,y:Math.random()*Hc,r:120+Math.random()*180,sp:0.15+Math.random()*0.2,hue:[280,200,320,190][i%4]});

  window.addEventListener('mousemove', shooterMouseMove);
  window.addEventListener('mousedown', shooterMouseDown);
  window.addEventListener('mouseup', shooterMouseUp);
  window.addEventListener('touchmove', shooterTouchMove, {passive:false});
  window.addEventListener('touchstart', shooterTouchStart, {passive:false});
  window.addEventListener('touchend', shooterTouchEnd);

  function canvasPos(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    return { x: (clientX-rect.left) * (W/rect.width), y: (clientY-rect.top) * (Hc/rect.height) };
  }
  window._shooterCanvasPos = canvasPos;

  function spawnEnemy() {
    const d = SH.diff;
    const roll = Math.random();
    const type = SH.wave >= 5 && roll < 0.12 ? 'elite'
      : SH.wave >= 3 && roll < 0.28 ? 'heavy'
      : roll < 0.42 ? 'zigzag' : 'drone';
    const x = 40 + Math.random() * (W-80);
    if (type === 'elite') SH.enemies.push({x,y:-46,w:40,h:40,type,hp:Math.ceil(6*d.hpMult),maxHp:Math.ceil(6*d.hpMult),speed:1.6*d.speedMult,shootTimer:70,points:80,glow:0});
    else if (type === 'heavy') SH.enemies.push({x,y:-40,w:52,h:52,type,hp:Math.ceil(4*d.hpMult),maxHp:Math.ceil(4*d.hpMult),speed:1.4*d.speedMult,shootTimer:60+Math.random()*60,points:60});
    else if (type === 'zigzag') SH.enemies.push({x,y:-30,w:32,h:32,type,hp:Math.ceil(1*d.hpMult),maxHp:Math.ceil(1*d.hpMult),speed:2.6*d.speedMult,dir:1,zigT:0,points:25});
    else SH.enemies.push({x,y:-30,w:34,h:34,type,hp:Math.ceil(1*d.hpMult),maxHp:Math.ceil(1*d.hpMult),speed:(1.8+Math.random()*0.8)*d.speedMult,shootTimer:80+Math.random()*80,points:15});
  }

  function spawnBoss() {
    SH.bossActive = true;
    const bossHp = Math.ceil((70+SH.wave*4) * SH.diff.hpMult);
    SH.enemies.push({x:W/2,y:-100,w:130,h:96,type:'boss',hp:bossHp,maxHp:bossHp,speed:1,dir:1,shootTimer:40,points:500,phase:0});
  }

  function spawnPowerup(x,y) {
    if (Math.random() > 0.14) return; // ~14% drop chance per kill
    const kinds = ['spread','rapid','shield','heal'];
    const kind = kinds[Math.floor(Math.random()*kinds.length)];
    SH.powerups.push({x,y,kind,vy:1.6,rot:0});
  }

  function update() {
    if (SH.gameOver) return;
    SH.elapsed++;
    updateLevel(SH);
    if (SH.shake > 0) SH.shake--;
    if (SH.comboTimer > 0) SH.comboTimer--; else SH.combo = 0;

    // player follow mouse/touch (smooth)
    SH.player.x += (SH.mouseX - SH.player.x) * 0.25;
    SH.player.y += (SH.mouseY - SH.player.y) * 0.25;
    SH.player.x = Math.max(24, Math.min(W-24, SH.player.x));
    SH.player.y = Math.max(60, Math.min(Hc-24, SH.player.y));
    if (SH.player.invuln > 0) SH.player.invuln--;
    if (SH.shieldActive > 0) SH.shieldActive--;
    if (SH.weaponTimer > 0) { SH.weaponTimer--; if (SH.weaponTimer === 0) SH.weapon = 'single'; }

    // firing — weapon-dependent pattern
    SH.player.cooldown--;
    if ((SH.firing || SH.autoFire) && SH.player.cooldown <= 0) {
      fireWeapon();
      SH.player.cooldown = SH.weapon === 'rapid' ? 4 : 8;
      playBeep(SH.weapon==='rapid'?1000:880, 0.04, 'square', 0.02);
    }

    // spawn logic
    SH.spawnTimer--;
    if (SH.spawnTimer <= 0 && !SH.bossActive) {
      spawnEnemy();
      SH.spawnTimer = Math.max(16, (55 - SH.wave*3) / SH.diff.spawnMult);
    }
    SH.waveTimer++;
    if (SH.waveTimer > 900 && !SH.bossActive) { // every ~15s at 60fps
      SH.waveTimer = 0; SH.wave++;
      if (SH.wave % 3 === 0) { SH.enemies=[]; spawnBoss(); }
    }

    // bullets
    SH.bullets.forEach(b => { b.x += b.vx||0; b.y += b.vy; });
    SH.bullets = SH.bullets.filter(b => b.y > -20 && b.x > -20 && b.x < W+20);
    SH.enemyBullets.forEach(b => { b.x += b.vx||0; b.y += b.vy; });
    SH.enemyBullets = SH.enemyBullets.filter(b => b.y < Hc+20 && b.y > -20);

    // powerups drift down
    SH.powerups.forEach(p => { p.y += p.vy; p.rot += 0.06; });
    SH.powerups = SH.powerups.filter(p => {
      if (Math.abs(p.x-SH.player.x) < 26 && Math.abs(p.y-SH.player.y) < 26) {
        applyPowerup(p.kind);
        return false;
      }
      return p.y < Hc+30;
    });

    // enemies
    SH.enemies.forEach(e => {
      if (e.type === 'boss') {
        e.y = Math.min(e.y + 1.2, 110);
        e.x += e.dir * (1.6 + SH.wave*0.05);
        if (e.x < 100 || e.x > W-100) e.dir *= -1;
        e.shootTimer--;
        if (e.shootTimer <= 0) {
          const spread = e.hp < e.maxHp*0.4 ? 3 : 2; // more bullets when low HP (enrage)
          for (let a=-spread;a<=spread;a++) SH.enemyBullets.push({x:e.x,y:e.y+30,vx:a*1.6*SH.diff.enemyDamageMult,vy:4.5*SH.diff.enemyDamageMult,w:6,h:12,color:'#ff4757'});
          e.shootTimer = e.hp < e.maxHp*0.4 ? 35 : 50;
          playBeep(120,0.15,'sawtooth',0.03);
        }
      } else if (e.type === 'zigzag') {
        e.y += e.speed;
        e.zigT += 0.08;
        e.x += Math.sin(e.zigT) * 3.2;
      } else if (e.type === 'elite') {
        e.y += e.speed;
        e.glow = (e.glow + 0.1) % (Math.PI*2);
        e.shootTimer--;
        if (e.shootTimer <= 0) {
          // tracking shot — aims at player's position at fire time
          const dx = SH.player.x - e.x, dy = SH.player.y - e.y, dist = Math.hypot(dx,dy)||1;
          SH.enemyBullets.push({x:e.x,y:e.y,vx:(dx/dist)*4*SH.diff.enemyDamageMult,vy:(dy/dist)*4*SH.diff.enemyDamageMult,w:7,h:7,color:'#ffd166'});
          e.shootTimer = 75;
        }
      } else {
        e.y += e.speed;
        if (e.type === 'drone') {
          e.shootTimer--;
          if (e.shootTimer <= 0) {
            SH.enemyBullets.push({x:e.x,y:e.y+16,vx:0,vy:5*SH.diff.enemyDamageMult,w:5,h:11,color:'#ff8a4c'});
            e.shootTimer = 90+Math.random()*60;
          }
        } else if (e.type === 'heavy') {
          e.shootTimer--;
          if (e.shootTimer <= 0) {
            SH.enemyBullets.push({x:e.x,y:e.y+22,vx:0,vy:4*SH.diff.enemyDamageMult,w:6,h:13,color:'#a78bfa'});
            e.shootTimer = 70+Math.random()*50;
          }
        }
      }
    });
    SH.enemies = SH.enemies.filter(e => e.y < Hc+80 && e.hp > 0);

    // collisions: player bullets vs enemies
    SH.bullets.forEach(b => {
      SH.enemies.forEach(e => {
        if (e.hp<=0) return;
        if (Math.abs(b.x-e.x) < e.w/2+4 && Math.abs(b.y-e.y) < e.h/2+8) {
          e.hp--; b.y = -999;
          spawnParticles(e.x, e.y, e.type==='boss'?'#ff4757':'#f5c518', 4);
          if (e.hp <= 0) {
            SH.combo++; SH.comboTimer = 90;
            const comboMult = 1 + Math.min(SH.combo, 10) * 0.1;
            SH.score += Math.round(e.points * comboMult);
            spawnParticles(e.x, e.y, '#f5c518', e.type==='elite'?26:18);
            spawnParticles(e.x, e.y, '#ff8a4c', 8);
            if (e.type !== 'boss') { SH.shake = Math.min(SH.shake+3, 10); spawnPowerup(e.x, e.y); }
            playBeep(e.type==='boss'?200:340, e.type==='boss'?0.3:0.08, 'square', 0.04);
            if (e.type === 'boss') { SH.bossActive = false; SH.score += 150; SH.shake = 20; }
          }
        }
      });
    });
    SH.bullets = SH.bullets.filter(b => b.y > -998);

    // collisions: enemy bullets & enemies vs player
    if (SH.player.invuln <= 0) {
      SH.enemyBullets.forEach(b => {
        if (Math.abs(b.x-SH.player.x) < 18 && Math.abs(b.y-SH.player.y) < 18) {
          hitPlayer(); b.y = Hc+999;
        }
      });
      SH.enemies.forEach(e => {
        if (Math.abs(e.x-SH.player.x) < e.w/2+14 && Math.abs(e.y-SH.player.y) < e.h/2+14) {
          hitPlayer(); e.hp = 0;
        }
      });
    }
    SH.enemyBullets = SH.enemyBullets.filter(b => b.y < Hc+900);

    // particles
    SH.particles.forEach(p => { p.x+=p.vx; p.y+=p.vy; p.vy+=0.05; p.life--; });
    SH.particles = SH.particles.filter(p => p.life > 0);

    // stars & nebulae (parallax)
    SH.stars.forEach(s => { s.y += s.sp; if (s.y > Hc) { s.y = 0; s.x = Math.random()*W; } });
    SH.nebulae.forEach(n => { n.y += n.sp; if (n.y - n.r > Hc) { n.y = -n.r; n.x = Math.random()*W; } });

    document.getElementById('gameScoreDisplay').textContent = fmtN(SH.score);

    if (SH.player.hp <= 0) endGame();
  }

  function fireWeapon() {
    const x = SH.player.x, y = SH.player.y - 20;
    if (SH.weapon === 'spread') {
      [-0.35,-0.15,0,0.15,0.35].forEach(ang => {
        SH.bullets.push({x, y, vx: Math.sin(ang)*7, vy: -11*Math.cos(ang), w:4, h:12});
      });
    } else {
      SH.bullets.push({x:x-10, y, vx:0, vy:-11, w:4, h:14});
      SH.bullets.push({x:x+10, y, vx:0, vy:-11, w:4, h:14});
    }
  }

  function applyPowerup(kind) {
    if (kind === 'spread') { SH.weapon = 'spread'; SH.weaponTimer = 600; playBeep(660,0.15,'sine',0.05); }
    else if (kind === 'rapid') { SH.weapon = 'rapid'; SH.weaponTimer = 600; playBeep(880,0.15,'sine',0.05); }
    else if (kind === 'shield') { SH.shieldActive = 480; playBeep(500,0.2,'sine',0.05); }
    else if (kind === 'heal') { SH.player.hp = Math.min(SH.player.maxHp, SH.player.hp+1); playBeep(740,0.2,'sine',0.05); }
    spawnParticles(SH.player.x, SH.player.y, '#7ee8ff', 12);
  }

  function hitPlayer() {
    if (SH.shieldActive > 0) { SH.shieldActive = Math.max(0, SH.shieldActive-120); SH.player.invuln = 30; spawnParticles(SH.player.x, SH.player.y, '#4ade80', 10); playBeep(300,0.1,'sine',0.04); return; }
    SH.player.hp--; SH.player.invuln = 60; SH.shake = Math.min(SH.shake+8, 16); SH.combo = 0;
    spawnParticles(SH.player.x, SH.player.y, '#ff4757', 14);
    playBeep(140,0.2,'sawtooth',0.06);
  }

  function spawnParticles(x,y,color,n) {
    for (let i=0;i<n;i++) SH.particles.push({x,y,vx:(Math.random()-0.5)*6,vy:(Math.random()-0.5)*6-1,life:22+Math.random()*10,color});
  }

  function endGame() {
    SH.gameOver = true;
    stopGameLoop();
    finishGame(SH.score, SH.battleCode);
  }

  function draw() {
    ctx.save();
    if (SH.shake > 0) ctx.translate((Math.random()-0.5)*SH.shake, (Math.random()-0.5)*SH.shake);

    ctx.fillStyle = '#04040a'; ctx.fillRect(-20,-20,W+40,Hc+40);

    // nebula backdrop (soft glowing blobs for visual depth)
    SH.nebulae.forEach(n => {
      const grad = ctx.createRadialGradient(n.x,n.y,0,n.x,n.y,n.r);
      grad.addColorStop(0, `hsla(${n.hue},70%,55%,.10)`);
      grad.addColorStop(1, 'hsla(0,0%,0%,0)');
      ctx.fillStyle = grad;
      ctx.beginPath(); ctx.arc(n.x,n.y,n.r,0,Math.PI*2); ctx.fill();
    });

    // stars
    ctx.fillStyle = '#ffffff';
    SH.stars.forEach(s => { ctx.globalAlpha = s.s/2.5; ctx.fillRect(s.x,s.y,s.s,s.s); });
    ctx.globalAlpha = 1;

    // powerups
    SH.powerups.forEach(p => drawPowerup(p));

    // player + shield
    if (!(SH.player.invuln > 0 && Math.floor(SH.player.invuln/4)%2===0)) {
      if (SH.shieldActive > 0) {
        ctx.save(); ctx.translate(SH.player.x, SH.player.y);
        ctx.strokeStyle = `rgba(74,222,128,${0.4+Math.sin(SH.elapsed*0.2)*0.2})`;
        ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.arc(0,0,30,0,Math.PI*2); ctx.stroke();
        ctx.restore();
      }
      drawShip(SH.player.x, SH.player.y, '#f5c518', '#fff3a3');
    }

    // bullets
    ctx.fillStyle = SH.weapon==='rapid' ? '#ffd166' : '#7ee8ff';
    SH.bullets.forEach(b => { ctx.fillRect(b.x-b.w/2, b.y-b.h/2, b.w, b.h); });
    SH.enemyBullets.forEach(b => { ctx.fillStyle = b.color||'#ff4757'; ctx.beginPath(); ctx.arc(b.x,b.y,b.w/2,0,Math.PI*2); ctx.fill(); });

    // enemies
    SH.enemies.forEach(e => {
      if (e.type === 'boss') drawBoss(e);
      else drawEnemy(e);
    });

    // particles
    SH.particles.forEach(p => { ctx.globalAlpha = Math.max(0,p.life/30); ctx.fillStyle = p.color; ctx.fillRect(p.x-2,p.y-2,4,4); });
    ctx.globalAlpha = 1;

    // HUD
    drawHUD();

    // Level-up banner draws last, on top of everything, but stays outside the shake transform
    // so it doesn't jitter.
    ctx.restore();
    drawLevelUpBanner(ctx, W, Hc);
  }

  function drawPowerup(p) {
    ctx.save(); ctx.translate(p.x,p.y); ctx.rotate(p.rot);
    const colors = { spread:'#7ee8ff', rapid:'#ffd166', shield:'#4ade80', heal:'#00d46a' };
 const icons = { spread:'S', rapid:'R', shield:'D', heal:'H' };
    ctx.fillStyle = colors[p.kind];
    ctx.globalAlpha = 0.25;
    ctx.beginPath(); ctx.arc(0,0,16,0,Math.PI*2); ctx.fill();
    ctx.globalAlpha = 1;
    ctx.restore();
    ctx.fillStyle = colors[p.kind]; ctx.font = '16px sans-serif'; ctx.textAlign='center';
    ctx.fillText(icons[p.kind], p.x, p.y+5);
  }

  function drawShip(x,y,c1,c2) {
    ctx.save(); ctx.translate(x,y);
    ctx.fillStyle = c1;
    ctx.beginPath(); ctx.moveTo(0,-20); ctx.lineTo(16,16); ctx.lineTo(0,8); ctx.lineTo(-16,16); ctx.closePath(); ctx.fill();
    ctx.fillStyle = c2;
    ctx.beginPath(); ctx.moveTo(0,-14); ctx.lineTo(6,4); ctx.lineTo(-6,4); ctx.closePath(); ctx.fill();
    ctx.fillStyle = 'rgba(126,232,255,.8)';
    ctx.fillRect(-4,14,8,6+Math.random()*6);
    ctx.restore();
  }

  function drawEnemy(e) {
    ctx.save(); ctx.translate(e.x,e.y);
    const color = e.type==='elite' ? '#ffd166' : e.type==='heavy' ? '#a78bfa' : e.type==='zigzag' ? '#ff8a4c' : '#ff4757';
    if (e.type==='elite') {
      ctx.shadowColor = color; ctx.shadowBlur = 8 + Math.sin(e.glow)*4;
    }
    ctx.fillStyle = color;
    if (e.type==='heavy') {
      ctx.fillRect(-e.w/2,-e.h/2,e.w,e.h);
      ctx.fillStyle='#1a1a2e'; ctx.fillRect(-e.w/2+8,-e.h/2+8,e.w-16,e.h-16);
    } else if (e.type==='elite') {
      ctx.beginPath();
      for (let i=0;i<6;i++) { const a=(Math.PI*2/6)*i; const px=Math.cos(a)*e.w/2, py=Math.sin(a)*e.h/2; i===0?ctx.moveTo(px,py):ctx.lineTo(px,py); }
      ctx.closePath(); ctx.fill();
    } else {
      ctx.beginPath(); ctx.moveTo(0,e.h/2); ctx.lineTo(e.w/2,-e.h/2); ctx.lineTo(0,-e.h/4); ctx.lineTo(-e.w/2,-e.h/2); ctx.closePath(); ctx.fill();
    }
    ctx.restore();
    if (e.hp < e.maxHp) {
      ctx.fillStyle='#333'; ctx.fillRect(e.x-e.w/2, e.y-e.h/2-10, e.w, 4);
      ctx.fillStyle='#ff4757'; ctx.fillRect(e.x-e.w/2, e.y-e.h/2-10, e.w*(e.hp/e.maxHp), 4);
    }
  }

  function drawBoss(e) {
    ctx.save(); ctx.translate(e.x,e.y);
    ctx.fillStyle = '#3a1a4a';
    ctx.fillRect(-e.w/2,-e.h/2,e.w,e.h);
    ctx.fillStyle = e.hp < e.maxHp*0.4 ? `rgba(255,71,87,${0.7+Math.sin(SH.elapsed*0.3)*0.3})` : '#ff4757';
    ctx.fillRect(-e.w/2+14,-e.h/2+14,e.w-28,e.h-28);
    ctx.fillStyle = '#ffd166';
    ctx.beginPath(); ctx.arc(0,0,10,0,Math.PI*2); ctx.fill();
    ctx.restore();
    ctx.fillStyle='#333'; ctx.fillRect(W/2-150, 16, 300, 10);
    ctx.fillStyle='#ff4757'; ctx.fillRect(W/2-150, 16, 300*(e.hp/e.maxHp), 10);
    ctx.fillStyle='#fff'; ctx.font='11px monospace'; ctx.textAlign='center';
    ctx.fillText(e.hp < e.maxHp*0.4 ? 'BOSS — ENRAGED' : 'BOSS', W/2, 14);
  }

  function drawHUD() {
    ctx.textAlign = 'left'; ctx.font = '13px monospace'; ctx.fillStyle = '#8888a8';
    ctx.fillText('LV.' + SH.level + '  ·  WAVE ' + SH.wave + '  ·  ' + SH.diff.label.toUpperCase(), 14, 24);
    if (SH.combo > 1) { ctx.fillStyle = '#f5c518'; ctx.font = 'bold 13px monospace'; ctx.fillText('COMBO x' + Math.min(SH.combo,10), 14, 42); }
 if (SH.weapon !== 'single') { ctx.fillStyle = SH.weapon==='rapid'?'#ffd166':'#7ee8ff'; ctx.font='11px monospace'; ctx.fillText((SH.weapon==='rapid'?'RAPID FIRE':'SPREAD SHOT') + ' ' + Math.ceil(SH.weaponTimer/60)+'s', 14, Hc-14); }
    for (let i=0;i<SH.player.maxHp;i++) {
      ctx.fillStyle = i < SH.player.hp ? '#ff4757' : '#333';
      ctx.beginPath(); ctx.arc(W-20-i*24, 20, 8, 0, Math.PI*2); ctx.fill();
    }
  }

  function loop() {
    update();
    draw();
    if (!SH.gameOver) gameLoopId = requestAnimationFrame(loop);
  }
  loop();
}

function shooterMouseMove(e) {
  if (!SH || !window._shooterCanvasPos) return;
  const p = window._shooterCanvasPos(e.clientX, e.clientY);
  SH.mouseX = p.x; SH.mouseY = p.y;
}
function shooterMouseDown() { if (SH) SH.firing = true; }
function shooterMouseUp() { if (SH) SH.firing = false; }
function shooterTouchMove(e) {
  if (!SH || !e.touches[0] || !window._shooterCanvasPos) return;
  e.preventDefault();
  const p = window._shooterCanvasPos(e.touches[0].clientX, e.touches[0].clientY);
  SH.mouseX = p.x; SH.mouseY = p.y;
}
function shooterTouchStart(e) { if (SH) { SH.firing = true; shooterTouchMove(e); } }
function shooterTouchEnd() { if (SH) SH.firing = false; }

// ═══════════════════════════════════════════════════════════
// TURBO RUN — lane racer (canvas 2D)
// ═══════════════════════════════════════════════════════════
let TR = null;

function startTurboRun(battleCode, difficulty) {
  const canvas = document.getElementById('gameCanvas');
  const ctx = canvas.getContext('2d');
  const W = canvas.width, Hc = canvas.height;
  const LANES = 4;
  const laneW = W / LANES;
  const DIFF = getDifficultyConfig(difficulty);

  TR = {
    battleCode,
    lane: 1.5, targetLane: 1.5, // fractional for smooth transition
    y: Hc - 110, w: 46, h: 78,
    speed: 6 * DIFF.speedMult, baseSpeed: 6 * DIFF.speedMult, maxSpeed: 22 * Math.min(1.3, DIFF.speedMult),
    distance: 0, score: 0, gameOver: false, level: 1,
    obstacles: [], coins: [], nitroPads: [],
    nitro: 0, nitroActive: 0, spawnTimer: 0, roadOffset: 0,
    particles: [], shake: 0, diff: DIFF
  };

  function laneX(lane) { return laneW * lane + laneW/2; }

  function pointerToLane(clientX) {
    const rect = canvas.getBoundingClientRect();
    const x = (clientX-rect.left) * (W/rect.width);
    return Math.max(0, Math.min(LANES-1, Math.floor(x / laneW)));
  }

  function onPointerMove(clientX) { TR.targetLane = pointerToLane(clientX); }
  function onMouseMove(e){ onPointerMove(e.clientX); }
  function onTouchMove(e){ if(e.touches[0]){ e.preventDefault(); onPointerMove(e.touches[0].clientX); } }
  function onBoostStart(){ if (TR.nitro >= 30) { TR.nitroActive = 90; TR.nitro -= 30; playBeep(600,0.15,'sawtooth',0.05); } }

  addGameListener(canvas, 'mousemove', onMouseMove);
  addGameListener(canvas, 'touchmove', onTouchMove, {passive:false});
  addGameListener(canvas, 'mousedown', onBoostStart);
  addGameListener(canvas, 'touchstart', (e)=>{ e.preventDefault(); onBoostStart(); onTouchMove(e); }, {passive:false});

  function spawnRow() {
    const blockedLanes = new Set();
    const numObstacles = Math.min(LANES-1, Math.round((1 + Math.floor(TR.speed/8)) * TR.diff.spawnMult));
    while (blockedLanes.size < numObstacles) blockedLanes.add(Math.floor(Math.random()*LANES));
    blockedLanes.forEach(lane => {
      const type = Math.random() < 0.25 ? 'truck' : 'car';
      TR.obstacles.push({lane, y:-100, w:type==='truck'?laneW*0.7:laneW*0.55, h:type==='truck'?100:64, type, color: type==='truck' ? '#a78bfa' : ['#ff4757','#4ade80','#ffd166'][Math.floor(Math.random()*3)]});
    });
    // coins/nitro in open lanes sometimes
    for (let l=0;l<LANES;l++) {
      if (!blockedLanes.has(l) && Math.random() < 0.3) {
        if (Math.random() < 0.2) TR.nitroPads.push({lane:l,y:-100,w:36,h:36});
        else TR.coins.push({lane:l,y:-100,w:24,h:24});
      }
    }
  }

  function update() {
    if (TR.gameOver) return;
    TR.distance += TR.speed;
    TR.score = Math.floor(TR.distance / 8);
    updateLevel(TR);
    TR.speed = Math.min(TR.maxSpeed, TR.baseSpeed + TR.distance/2200);
    TR.roadOffset = (TR.roadOffset + TR.speed*(TR.nitroActive>0?1.8:1)) % 80;

    if (TR.nitroActive > 0) { TR.nitroActive--; }
    else { TR.nitro = Math.min(100, TR.nitro + 0.06); }
    const effSpeed = TR.speed * (TR.nitroActive>0 ? 1.9 : 1);

    TR.lane += (TR.targetLane - TR.lane) * 0.18;

    TR.spawnTimer -= effSpeed;
    if (TR.spawnTimer <= 0) { spawnRow(); TR.spawnTimer = Math.max(50, (170 - TR.speed*4) / TR.diff.spawnMult); }

    [TR.obstacles, TR.coins, TR.nitroPads].forEach(arr => arr.forEach(o => o.y += effSpeed));
    TR.obstacles = TR.obstacles.filter(o => o.y < Hc+120);
    TR.coins = TR.coins.filter(o => o.y < Hc+50);
    TR.nitroPads = TR.nitroPads.filter(o => o.y < Hc+50);

    const px = laneX(TR.lane);
    // collisions
    TR.obstacles.forEach(o => {
      const ox = laneX(o.lane);
      if (Math.abs(o.y - TR.y) < (o.h+TR.h)/2 - 14 && Math.abs(ox-px) < (o.w+TR.w)/2 - 8) {
        endGame();
      }
    });
    TR.coins = TR.coins.filter(o => {
      const ox = laneX(o.lane);
      if (Math.abs(o.y - TR.y) < 40 && Math.abs(ox-px) < 34) {
        TR.score += 25; spawnParticles(ox, TR.y, '#f5c518', 10); playBeep(1000,0.05,'square',0.03);
        return false;
      }
      return true;
    });
    TR.nitroPads = TR.nitroPads.filter(o => {
      const ox = laneX(o.lane);
      if (Math.abs(o.y - TR.y) < 40 && Math.abs(ox-px) < 34) {
        TR.nitro = Math.min(100, TR.nitro + 40); spawnParticles(ox, TR.y, '#4ade80', 14); playBeep(700,0.1,'sine',0.04);
        return false;
      }
      return true;
    });

    TR.particles.forEach(p=>{p.x+=p.vx;p.y+=p.vy;p.life--;});
    TR.particles = TR.particles.filter(p=>p.life>0);
    if (TR.shake>0) TR.shake--;

    document.getElementById('gameScoreDisplay').textContent = fmtN(TR.score);
  }

  function spawnParticles(x,y,color,n) {
    for (let i=0;i<n;i++) TR.particles.push({x,y,vx:(Math.random()-0.5)*5,vy:(Math.random()-0.5)*5,life:20,color});
  }

  function endGame() {
    TR.gameOver = true; TR.shake = 20;
    playBeep(100,0.4,'sawtooth',0.08);
    stopGameLoop();
    setTimeout(()=>finishGame(TR.score, TR.battleCode), 200);
  }

  function draw() {
    ctx.save();
    if (TR.shake>0) ctx.translate((Math.random()-0.5)*TR.shake, (Math.random()-0.5)*TR.shake);

    // road
    ctx.fillStyle = '#1a1a24'; ctx.fillRect(0,0,W,Hc);
    ctx.fillStyle = '#232330'; ctx.fillRect(0,0,W,Hc);
    for (let l=1;l<LANES;l++) {
      ctx.strokeStyle = 'rgba(255,255,255,.15)'; ctx.lineWidth = 3; ctx.setLineDash([24,20]);
      ctx.lineDashOffset = -TR.roadOffset;
      ctx.beginPath(); ctx.moveTo(l*laneW,0); ctx.lineTo(l*laneW,Hc); ctx.stroke();
    }
    ctx.setLineDash([]);
    // side barriers
    ctx.fillStyle = '#f5c518';
    for (let y=-40+((TR.roadOffset*1.2)%40); y<Hc; y+=40) { ctx.fillRect(4,y,8,20); ctx.fillRect(W-12,y,8,20); }

    // nitro pads / coins
 TR.nitroPads.forEach(o => { ctx.font='28px sans-serif'; ctx.textAlign='center'; ctx.fillText('', laneX(o.lane), o.y); });
    TR.coins.forEach(o => { ctx.fillStyle='#f5c518'; ctx.beginPath(); ctx.arc(laneX(o.lane), o.y, 10, 0, Math.PI*2); ctx.fill(); ctx.fillStyle='#a87904'; ctx.font='11px sans-serif'; ctx.textAlign='center'; ctx.fillText('$',laneX(o.lane),o.y+4); });

    // obstacles
    TR.obstacles.forEach(o => {
      const ox = laneX(o.lane);
      ctx.fillStyle = o.color;
      roundRect(ctx, ox-o.w/2, o.y-o.h/2, o.w, o.h, 8); ctx.fill();
      ctx.fillStyle = 'rgba(0,0,0,.3)';
      roundRect(ctx, ox-o.w/2+6, o.y-o.h/2+10, o.w-12, o.h*0.35, 4); ctx.fill();
    });

    // particles
    TR.particles.forEach(p => { ctx.globalAlpha = p.life/20; ctx.fillStyle = p.color; ctx.fillRect(p.x-2,p.y-2,4,4); });
    ctx.globalAlpha = 1;

    // player car
    const px = laneX(TR.lane);
    ctx.save(); ctx.translate(px, TR.y);
    if (TR.nitroActive>0) { ctx.fillStyle='rgba(74,222,128,.3)'; ctx.fillRect(-TR.w/2-4,20,TR.w+8,60); }
    ctx.fillStyle = '#f5c518';
    roundRect(ctx, -TR.w/2, -TR.h/2, TR.w, TR.h, 10); ctx.fill();
    ctx.fillStyle = '#1a1a24';
    roundRect(ctx, -TR.w/2+7, -TR.h/2+10, TR.w-14, TR.h*0.4, 5); ctx.fill();
    ctx.fillStyle = TR.nitroActive>0 ? '#4ade80' : '#ff8a4c';
    ctx.fillRect(-8, TR.h/2-6, 16, 10+Math.random()*8);
    ctx.restore();

    ctx.restore();

    // HUD
    ctx.textAlign='left'; ctx.font='13px monospace'; ctx.fillStyle='#8888a8';
    ctx.fillText('LV.' + TR.level + '  ·  SPEED ' + Math.round(TR.speed*10) + '  ·  ' + TR.diff.label.toUpperCase(), 14, 24);
    ctx.fillStyle='#333'; ctx.fillRect(W-160,14,140,14);
    ctx.fillStyle= TR.nitro>=30 ? '#4ade80' : '#287a4a'; ctx.fillRect(W-160,14,140*(TR.nitro/100),14);
    ctx.strokeStyle='#555'; ctx.strokeRect(W-160,14,140,14);
    ctx.fillStyle='#fff'; ctx.font='10px monospace'; ctx.textAlign='center'; ctx.fillText('NITRO', W-90, 24);

    drawLevelUpBanner(ctx, W, Hc);
  }

  function loop() { update(); draw(); if (!TR.gameOver) gameLoopId = requestAnimationFrame(loop); }
  loop();
}

function roundRect(ctx,x,y,w,h,r) {
  ctx.beginPath();
  ctx.moveTo(x+r,y);
  ctx.arcTo(x+w,y,x+w,y+h,r);
  ctx.arcTo(x+w,y+h,x,y+h,r);
  ctx.arcTo(x,y+h,x,y,r);
  ctx.arcTo(x,y,x+w,y,r);
  ctx.closePath();
}

// ═══════════════════════════════════════════════════════════
// BASE DEFENSE — tower defense (canvas 2D)
// ═══════════════════════════════════════════════════════════
let BD = null;

function startBaseDefense(battleCode, difficulty) {
  const canvas = document.getElementById('gameCanvas');
  const ctx = canvas.getContext('2d');
  const W = canvas.width, Hc = canvas.height;
  const PATH_Y = Hc - 90;
  const BASE_X = 60;
  const SLOT_Y = PATH_Y - 70;
  const SLOTS = 6;
  const slotSpacing = (W - 200) / (SLOTS-1);
  const DIFF = getDifficultyConfig(difficulty);

  const TURRET_COST = 50;
  const UPGRADE_COST = 40;

  BD = {
    battleCode, gold: Math.round(120 / Math.max(1, DIFF.hpMult)), baseHp: 10, baseMaxHp: 10,
    wave: 0, waveActive: false, waveTimer: 180, spawnQueue: [], spawnTimer: 0,
    enemies: [], turrets: [], bullets: [], particles: [],
    score: 0, gameOver: false, selectedSlot: null, level: 1, diff: DIFF
  };

  function slotPos(i) { return { x: 160 + i*slotSpacing, y: SLOT_Y }; }

  function onCanvasClick(e) {
    if (BD.gameOver) return;
    const rect = canvas.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    const x = (clientX-rect.left) * (W/rect.width);
    const y = (clientY-rect.top) * (Hc/rect.height);
    for (let i=0;i<SLOTS;i++) {
      const p = slotPos(i);
      if (Math.hypot(x-p.x, y-p.y) < 34) { handleSlotTap(i); return; }
    }
  }
  addGameListener(canvas, 'click', onCanvasClick);
  addGameListener(canvas, 'touchstart', (e)=>{ e.preventDefault(); onCanvasClick(e); }, {passive:false});

  function handleSlotTap(i) {
    const existing = BD.turrets.find(t => t.slot === i);
    if (!existing) {
      if (BD.gold < TURRET_COST) { flashMsg('Not enough gold!'); return; }
      BD.gold -= TURRET_COST;
      BD.turrets.push({ slot:i, level:1, cooldown:0, range:150, damage:2, fireRate:40 });
      playBeep(500,0.08,'square',0.03);
    } else {
      if (existing.level >= 4) { flashMsg('Max level!'); return; }
      if (BD.gold < UPGRADE_COST*existing.level) { flashMsg('Not enough gold to upgrade!'); return; }
      BD.gold -= UPGRADE_COST*existing.level;
      existing.level++; existing.damage += 2; existing.range += 15; existing.fireRate = Math.max(14, existing.fireRate-6);
      playBeep(700,0.1,'square',0.04);
    }
  }

  let flashText = ''; let flashTimer = 0;
  function flashMsg(msg) { flashText = msg; flashTimer = 90; }

  function startWave() {
    BD.wave++;
    BD.waveActive = true;
    const d = BD.diff;
    const count = Math.round((5 + BD.wave*2) * d.spawnMult);
    BD.spawnQueue = [];
    for (let i=0;i<count;i++) {
      const isTank = BD.wave >= 3 && i % 4 === 0;
      BD.spawnQueue.push(isTank
        ? {hp:Math.ceil((14+BD.wave*3)*d.hpMult),speed:0.6*d.speedMult,reward:12,type:'tank'}
        : {hp:Math.ceil((4+BD.wave)*d.hpMult),speed:(1.1+Math.random()*0.4)*d.speedMult,reward:5,type:'grunt'});
    }
    if (BD.wave % 5 === 0) BD.spawnQueue.push({hp:Math.ceil((60+BD.wave*10)*d.hpMult), speed:0.5*d.speedMult, reward:50, type:'boss'});
  }

  function update() {
    if (BD.gameOver) return;
    updateLevel(BD);

    if (!BD.waveActive) {
      BD.waveTimer--;
      if (BD.waveTimer <= 0) startWave();
    } else {
      BD.spawnTimer--;
      if (BD.spawnTimer <= 0 && BD.spawnQueue.length) {
        const spec = BD.spawnQueue.shift();
        BD.enemies.push({ x: W+30, y: PATH_Y, hp: spec.hp, maxHp: spec.hp, speed: spec.speed, reward: spec.reward, type: spec.type });
        BD.spawnTimer = 35;
      }
      if (!BD.spawnQueue.length && !BD.enemies.length) {
        BD.waveActive = false; BD.waveTimer = 240; BD.gold += 20 + BD.wave*3;
      }
    }

    BD.enemies.forEach(e => { e.x -= e.speed; });
    BD.enemies = BD.enemies.filter(e => {
      if (e.x <= BASE_X) { BD.baseHp--; playBeep(150,0.2,'sawtooth',0.05); return false; }
      return e.hp > 0;
    });
    if (BD.baseHp <= 0) { endGame(); return; }

    BD.turrets.forEach(t => {
      t.cooldown--;
      const p = slotPos(t.slot);
      if (t.cooldown <= 0) {
        const target = BD.enemies.find(e => Math.hypot(e.x-p.x, e.y-p.y) < t.range);
        if (target) {
          BD.bullets.push({ x:p.x, y:p.y, target, damage:t.damage, speed:9 });
          t.cooldown = t.fireRate;
        }
      }
    });

    BD.bullets.forEach(b => {
      if (!b.target || b.target.hp<=0) { b.dead=true; return; }
      const dx=b.target.x-b.x, dy=b.target.y-b.y, dist=Math.hypot(dx,dy);
      if (dist < 10) {
        b.target.hp -= b.damage; b.dead = true;
        spawnParticles(b.target.x,b.target.y,'#f5c518',5);
        if (b.target.hp <= 0) { BD.gold += b.target.reward; BD.score += b.target.reward*2; spawnParticles(b.target.x,b.target.y,'#ff4757',12); playBeep(400,0.06,'square',0.03); }
      } else {
        b.x += (dx/dist)*b.speed; b.y += (dy/dist)*b.speed;
      }
    });
    BD.bullets = BD.bullets.filter(b => !b.dead);

    BD.particles.forEach(p=>{p.x+=p.vx;p.y+=p.vy;p.life--;});
    BD.particles = BD.particles.filter(p=>p.life>0);
    if (flashTimer>0) flashTimer--;

    document.getElementById('gameScoreDisplay').textContent = fmtN(BD.score);
  }

  function spawnParticles(x,y,color,n) {
    for (let i=0;i<n;i++) BD.particles.push({x,y,vx:(Math.random()-0.5)*5,vy:(Math.random()-0.5)*5,life:18,color});
  }

  function endGame() {
    BD.gameOver = true;
    playBeep(90,0.5,'sawtooth',0.08);
    stopGameLoop();
    setTimeout(()=>finishGame(BD.score, BD.battleCode), 200);
  }

  function draw() {
    ctx.fillStyle = '#0f1710'; ctx.fillRect(0,0,W,Hc);
    // path
    ctx.fillStyle = '#2a2418'; ctx.fillRect(0, PATH_Y-24, W, 48);
    ctx.strokeStyle='rgba(255,255,255,.08)'; ctx.setLineDash([16,10]); ctx.beginPath(); ctx.moveTo(0,PATH_Y); ctx.lineTo(W,PATH_Y); ctx.stroke(); ctx.setLineDash([]);

    // base
    ctx.fillStyle = '#4ade80';
    roundRect(ctx, BASE_X-30, PATH_Y-40, 40, 80, 8); ctx.fill();
    ctx.fillStyle='#fff'; ctx.font='bold 16px sans-serif'; ctx.textAlign='center'; ctx.fillText('BASE', BASE_X-10, PATH_Y+8);

    // turret slots
    for (let i=0;i<SLOTS;i++) {
      const p = slotPos(i);
      const t = BD.turrets.find(x=>x.slot===i);
      ctx.strokeStyle = 'rgba(255,255,255,.15)'; ctx.setLineDash([4,4]);
      ctx.beginPath(); ctx.arc(p.x,p.y,t?t.range:150,0,Math.PI*2); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = t ? '#a78bfa' : 'rgba(255,255,255,.08)';
      ctx.beginPath(); ctx.arc(p.x,p.y,22,0,Math.PI*2); ctx.fill();
      if (t) {
        ctx.fillStyle='#1a1a2e'; ctx.font='11px monospace'; ctx.textAlign='center'; ctx.fillText('Lv'+t.level, p.x, p.y+4);
      } else {
        ctx.fillStyle='rgba(255,255,255,.4)'; ctx.font='18px sans-serif'; ctx.textAlign='center'; ctx.fillText('+', p.x, p.y+6);
      }
    }

    // enemies
    BD.enemies.forEach(e => {
      ctx.fillStyle = e.type==='boss' ? '#ff4757' : e.type==='tank' ? '#a78bfa' : '#ff8a4c';
      const size = e.type==='boss'?26:e.type==='tank'?20:14;
      ctx.beginPath(); ctx.arc(e.x, e.y, size, 0, Math.PI*2); ctx.fill();
      ctx.fillStyle='#333'; ctx.fillRect(e.x-16, e.y-size-12, 32, 4);
      ctx.fillStyle='#ff4757'; ctx.fillRect(e.x-16, e.y-size-12, 32*(e.hp/e.maxHp), 4);
    });

    // bullets
    ctx.fillStyle = '#7ee8ff';
    BD.bullets.forEach(b => { ctx.beginPath(); ctx.arc(b.x,b.y,3,0,Math.PI*2); ctx.fill(); });

    // particles
    BD.particles.forEach(p => { ctx.globalAlpha = p.life/18; ctx.fillStyle = p.color; ctx.fillRect(p.x-2,p.y-2,4,4); });
    ctx.globalAlpha = 1;

    // HUD
    ctx.textAlign='left'; ctx.font='13px monospace';
 ctx.fillStyle='#f5c518'; ctx.fillText(' '+BD.gold, 14, 24);
    ctx.fillStyle='#ff4757'; ctx.fillText('HP '+BD.baseHp+'/'+BD.baseMaxHp, 14, 42);
    ctx.fillStyle='#8888a8'; ctx.textAlign='right';
    ctx.fillText('LV.'+BD.level+'  ·  '+(BD.waveActive ? 'WAVE '+BD.wave : 'Next wave in '+Math.ceil(BD.waveTimer/60)+'s') + '  ·  ' + BD.diff.label.toUpperCase(), W-14, 24);
    if (flashTimer>0) { ctx.fillStyle='#ff4757'; ctx.font='14px monospace'; ctx.textAlign='center'; ctx.fillText(flashText, W/2, 40); }

    drawLevelUpBanner(ctx, W, Hc);
  }

  function loop() { update(); draw(); if (!BD.gameOver) gameLoopId = requestAnimationFrame(loop); }
  loop();
}
