(() => {

  // =========================
  // WAVE
  // =========================
  async function loadLevelsFromXML(url) {
    const res = await fetch(url);
    const text = await res.text();

    const parser = new DOMParser();
    const xml = parser.parseFromString(text, "application/xml");

    return parseLevelsXML(xml);
  }

  function parseLevelsXML(xml) {
    const root = xml.querySelector("levels");

    // --- Player cooldowns ---
    const playerCooldowns = {
      knight: parseFloat(root.getAttribute("player_cooldown_knight")),
      archer: parseFloat(root.getAttribute("player_cooldown_archer")),
      horseman: parseFloat(root.getAttribute("player_cooldown_horseman")),
      shield: parseFloat(root.getAttribute("player_cooldown_shield"))
    };

    const levels = {};

    root.querySelectorAll("waves").forEach(wavesNode => {
      const level = parseInt(wavesNode.getAttribute("level"), 10);
      const loop = wavesNode.getAttribute("loop") === "true";
      const loopAfter = parseFloat(wavesNode.getAttribute("loopAfter")) || 0;

      const waves = [];

      wavesNode.querySelectorAll("wave").forEach(waveNode => {
        waveNode.querySelectorAll("spawn").forEach(spawn => {
          waves.push({
            t: parseFloat(spawn.getAttribute("time")),
            unit: spawn.getAttribute("unit"),
            count: parseInt(spawn.getAttribute("count") || "1", 10),
            spacing: parseFloat(spawn.getAttribute("spacing") || "0")
          });
        });
      });

      levels[level] = { waves, loop, loopAfter };
    });

    return {
      levels,
      playerCooldowns
    };
  }

  // =========================
  // SPRITES
  // =========================
  const SPRITES = {
    knight: {
      image: new Image(),
      frameWidth: 64,
      frameHeight: 64,
      states: {
        move: 0,
        attack: 1,
        hit: 2,
        die: 3
      }
    },
    archer: {
      image: new Image(),
      frameWidth: 64,
      frameHeight: 64,
      states: {
        move: 0,
        attack: 1,
        hit: 2,
        die: 3
      }
    },
    horseman: {
      image: new Image(),
      frameWidth: 64,
      frameHeight: 64,
      states: {
        move: 0,
        attack: 1,
        hit: 2,
        die: 3
      }
    },
    shield: {
      image: new Image(),
      frameWidth: 64,
      frameHeight: 64,
      states: {
        move: 0,
        attack: 1,
        hit: 2,
        die: 3
      }
    }
  };

  SPRITES.knight.image.src = "assets/knight.png";
  SPRITES.archer.image.src = "assets/archer.png";
  SPRITES.horseman.image.src = "assets/horseman.png";
  SPRITES.shield.image.src = "assets/shield.png";

  // =========================
  // Config
  // =========================
  const CANVAS = document.getElementById("game");
  const ctx = CANVAS.getContext("2d");

  const uiPlayerHp = document.getElementById("playerHp");
  const uiEnemyHp = document.getElementById("enemyHp");

  // Base spawn cooldowns (seconds) per unit
  const BASE_SPAWN_COOLDOWNS = {
    knight: 2.5,
    archer: 3.0,
    horseman: 4.0,
    shield: 5.0
  };
  // Battlefield layout (single lane)
  const FIELD = {
    x: 0,
    y: 0,
    w: CANVAS.width,
    h: CANVAS.height,
    laneY: Math.floor(CANVAS.height * 0.52),
    laneH: 70,
    padding: 40,
  };

  // Castles (simple rectangles)
  const CASTLE = {
    w: 130,
    h: 200,
    y: FIELD.laneY - 130,
  };

  const FIXED_DT = 1 / 60;     // fixed logic step (seconds)
  const MAX_CATCHUP = 0.25;    // prevent spiral of death

  const ANIM_TOGGLE_EVERY = 0.16; // seconds: each state has 2 frames → toggle
  const HIT_STUN = 0.12;          // seconds: brief "damage" state
  const DEATH_TIME = 0.55;        // seconds: die animation duration

  // Unit templates (tweak freely)
  const UNIT_TEMPLATES = {
    knight: {
      name: "Knight",
      size: 26,
      maxHp: 120,
      speed: 55,
      damage: 20,
      attackRange: 18,
      attackCooldown: 0.8,
      type: "melee",
    },
    archer: {
      name: "Archer",
      size: 24,
      maxHp: 80,
      speed: 45,
      damage: 14,
      attackRange: 170,
      attackCooldown: 1.0,
      type: "ranged",
      projectileSpeed: 320,
    },
    horseman: {
      name: "Horseman",
      size: 28,
      maxHp: 105,
      speed: 95,          // fast
      damage: 18,
      attackRange: 18,
      attackCooldown: 0.75,
      type: "melee",
    },
    shield: {
      name: "Shield",
      size: 28,
      maxHp: 160,
      speed: 40,
      damage: 10,
      attackRange: 18,
      attackCooldown: 1.05,
      type: "melee",
      auraRadius: 95,
      auraReduction: 0.5, // halves damage
    },
  };

  // =========================
  // Enemy wave scripting
  // =========================
  // Each event is an absolute time (seconds since match start).
  // Customize freely: timing, unit type, count, spacing.
  const WAVES = [
    { t: 1.5,  unit: "knight", count: 1 },
    { t: 3.0,  unit: "archer", count: 1 },
    { t: 5.5,  unit: "knight", count: 2, spacing: 0.5 },
    { t: 9.0,  unit: "horseman", count: 1 },
    { t: 12.0, unit: "shield", count: 1 },
    { t: 14.0, unit: "archer", count: 2, spacing: 0.8 },
    { t: 18.0, unit: "horseman", count: 2, spacing: 0.6 },
    { t: 24.0, unit: "knight", count: 3, spacing: 0.45 },
    // You can add more events...
  ];

  // Optional: loop waves (simple)
  const LOOP_WAVES = true;
  const LOOP_AFTER = 30; // seconds (if LOOP_WAVES true)

  // =========================
  // Helpers
  // =========================
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  function rectsOverlap(a, b) {
    return (
      a.x < b.x + b.w &&
      a.x + a.w > b.x &&
      a.y < b.y + b.h &&
      a.y + a.h > b.y
    );
  }

  function dist(ax, ay, bx, by) {
    const dx = ax - bx;
    const dy = ay - by;
    return Math.hypot(dx, dy);
  }

  // =========================
  // Entities
  // =========================
  class Projectile {
  constructor({ x, y, vx, team, damage, arcHeight = 0, range = 0 }) {
      this.startX = x;
      this.startY = y;

      this.x = x;
      this.y = y;

      this.vx = vx;
      this.team = team;
      this.damage = damage;

      this.arcHeight = arcHeight; // 0 = straight line
      this.range = range;

      this.travelled = 0;
      this.r = 4;
      this.dead = false;
    }

    update(dt, game) {
      const dx = this.vx * dt;
      this.x += dx;
      this.travelled += Math.abs(dx);

      // Parabolic Y offset (if arcHeight > 0)
      if (this.arcHeight > 0 && this.range > 0) {
        const t = Math.min(this.travelled / this.range, 1);
        const arc = this.arcHeight * 4 * t * (1 - t);
        this.y = this.startY - arc;
      }

      // Offscreen or exceeded range
      if (
        this.x < -50 ||
        this.x > FIELD.w + 50 ||
        (this.range > 0 && this.travelled >= this.range)
      ) {
        this.dead = true;
        return;
      }

      // Collision logic stays exactly the same
      const targets = game.units.filter(u => u.team !== this.team && u.isAlive());
      for (const u of targets) {
        const hitbox = u.getRect();
        const bullet = { x: this.x - this.r, y: this.y - this.r, w: this.r * 2, h: this.r * 2 };
        if (rectsOverlap(bullet, hitbox)) {
          u.takeDamage(this.damage, game);
          this.dead = true;
          return;
        }
      }

      const enemyCastleRect =
        this.team === "player" ? game.enemyCastleRect : game.playerCastleRect;

      const bullet = { x: this.x - this.r, y: this.y - this.r, w: this.r * 2, h: this.r * 2 };
      if (rectsOverlap(bullet, enemyCastleRect)) {
        if (this.team === "player") game.enemyCastleHp -= this.damage;
        else game.playerCastleHp -= this.damage;
        this.dead = true;
      }
    }


    draw(ctx) {
      ctx.save();
      ctx.fillStyle = "#111";
      ctx.beginPath();
      ctx.arc(this.x, this.y, this.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  class Unit {
    constructor({ team, kind, x }) {
      const tpl = UNIT_TEMPLATES[kind];
      this.team = team;      // "player" | "enemy"
      this.kind = kind;

      this.size = tpl.size;
      this.maxHp = tpl.maxHp;
      this.hp = tpl.maxHp;

      this.speed = tpl.speed;
      this.damage = tpl.damage;
      this.attackRange = tpl.attackRange;
      this.attackCooldown = tpl.attackCooldown;
      this.type = tpl.type;

      this.projectileSpeed = tpl.projectileSpeed ?? 0;

      // shield aura (only for kind="shield")
      this.auraRadius = tpl.auraRadius ?? 0;
      this.auraReduction = tpl.auraReduction ?? 1;

      // Position (single lane)
      this.x = x;
      this.y = FIELD.laneY - Math.floor(this.size / 2);

      // State machine
      this.state = "move"; // move | attack | hit | die
      this.stateTime = 0;

      this.attackTimer = 0;
      this.hitTimer = 0;
      this.deathTimer = 0;

      // 2-frame animation toggle
      this.animTimer = 0;
      this.animFrame = 0; // 0 or 1

      // simple push separation
      this.blocked = false;
    }

    isAlive() {
      return this.state !== "die";
    }

    getRect() {
      return { x: this.x, y: this.y, w: this.size, h: this.size };
    }

    center() {
      return { cx: this.x + this.size / 2, cy: this.y + this.size / 2 };
    }

    // Damage reduction from allied shield units within aura radius
    computeDamageMultiplier(game) {
      // Only apply reduction if there is at least one friendly shield nearby.
      const { cx, cy } = this.center();
      const allies = game.units.filter(u => u.team === this.team && u.kind === "shield" && u.isAlive());
      for (const s of allies) {
        const sc = s.center();
        const d = dist(cx, cy, sc.cx, sc.cy);
        if (d <= s.auraRadius) return 0.5; // halves damage
      }
      return 1.0;
    }

    takeDamage(amount, game) {
      if (this.state === "die") return;

      const mult = this.computeDamageMultiplier(game);
      const final = amount * mult;

      this.hp -= final;

      // brief hit state if still alive
      if (this.hp > 0) {
        this.state = "hit";
        this.hitTimer = HIT_STUN;
        this.stateTime = 0;
      } else {
        this.hp = 0;
        this.state = "die";
        this.deathTimer = DEATH_TIME;
        this.stateTime = 0;
      }
    }

    findNearestTarget(game) {
      // targets are enemy units first; otherwise castle
      const enemies = game.units
        .filter(u => u.team !== this.team && u.isAlive())
        .sort((a, b) => {
          // nearest in X direction
          const da = Math.abs(a.x - this.x);
          const db = Math.abs(b.x - this.x);
          return da - db;
        });

      if (enemies.length > 0) return { type: "unit", target: enemies[0] };
      return { type: "castle", target: null };
    }

    inAttackRangeToUnit(enemy) {
      // Measure distance in X along lane for simplicity
      const myFront = (this.team === "player") ? (this.x + this.size) : this.x;
      const enemyFront = (this.team === "player") ? enemy.x : (enemy.x + enemy.size);
      const gap = Math.abs(enemyFront - myFront);
      return gap <= this.attackRange;
    }

    drawHpBar(ctx) {
      const hpPct = this.hp / this.maxHp;
      const barW = this.size;
      const barH = 5;
      const bx = this.x;
      const by = this.y - 30;

      ctx.fillStyle = "#ddd";
      ctx.fillRect(bx, by, barW, barH);
      ctx.fillStyle = "#111";
      ctx.fillRect(bx, by, barW * hpPct, barH);
    }

    update(dt, game) {
      // animation frame toggle
      this.animTimer += dt;
      if (this.animTimer >= ANIM_TOGGLE_EVERY) {
        this.animTimer -= ANIM_TOGGLE_EVERY;
        this.animFrame = 1 - this.animFrame;
      }

      // state timers
      this.stateTime += dt;

      if (this.state === "die") {
        this.deathTimer -= dt;
        return;
      }

      if (this.state === "hit") {
        this.hitTimer -= dt;
        if (this.hitTimer <= 0) {
          this.state = "move";
          this.stateTime = 0;
        }
        return;
      }

      // cooldown
      this.attackTimer = Math.max(0, this.attackTimer - dt);

      // Movement blocking: stop if there is an enemy in front inside attack range
      let shouldAttack = false;

      // Decide behavior
      var { type, target } = this.findNearestTarget(game);

      // Attack castle when close enough
      const castleRect = (this.team === "player") ? game.enemyCastleRect : game.playerCastleRect;
      const myFront = (this.team === "player") ? (this.x + this.size) : this.x;
      const castleEdge = (this.team === "player") ? castleRect.x : (castleRect.x + castleRect.w);
      const gap = Math.abs(castleEdge - myFront);
      if (gap <= this.attackRange)
      {
        shouldAttack = true;
        type = "castle";
        target = null;
      } 

      if (!shouldAttack) {
        if (type === "unit" && target) {
          if (this.inAttackRangeToUnit(target)) {
            shouldAttack = true;
          }
        }
      }

      if (shouldAttack) {
        this.state = "attack";
        if (this.attackTimer <= 0) {
          this.performAttack(game, target);
          this.attackTimer = this.attackCooldown;
        }
      } else {
        this.state = "move";
        // move forward
        const dir = (this.team === "player") ? 1 : -1;
        this.x += dir * this.speed * dt;
      }
    }

    performAttack(game, enemyUnit) {
      if (this.type === "ranged") {
        const { cx, cy } = this.center();
        const dir = this.team === "player" ? 1 : -1;

        const range = this.attackRange;
        const speed = this.projectileSpeed;

        game.projectiles.push(new Projectile({
          x: cx + dir * (this.size / 2),
          y: cy,
          vx: dir * speed,
          team: this.team,
          damage: this.damage,
          arcHeight: 35,   // ← TUNE THIS (visual height)
          range: range
        }));
        return;
      }

      // melee
      if (enemyUnit && enemyUnit.isAlive()) {
        enemyUnit.takeDamage(this.damage, game);
        return;
      }

      // hit castle if no unit target
      if (this.team === "player") game.enemyCastleHp -= this.damage;
      else game.playerCastleHp -= this.damage;
    }

    drawUnitSprite(ctx) {
      const sprite = SPRITES[this.kind];
      if (!sprite || !sprite.image.complete) return;

      const row = sprite.states[this.state] ?? sprite.states.move;
      const col = this.animFrame;

      const sw = sprite.frameWidth;
      const sh = sprite.frameHeight;
      const sx = col * sw;
      const sy = row * sh;

      // Center sprite over unit logic box
      const dx = this.x - (sw - this.size) / 2;
      const dy = this.y - (sh - this.size) / 2;

      ctx.save();

      // Flip enemy units
      if (this.team === "enemy") {
        ctx.translate(dx + sw / 2, 0);
        ctx.scale(-1, 1);
        ctx.translate(-(dx + sw / 2), 0);
      }

      // Die animation fade
      if (this.state === "die") {
        ctx.globalAlpha = Math.max(0, this.deathTimer / DEATH_TIME);
      }

      ctx.drawImage(
        sprite.image,
        sx, sy, sw, sh,
        dx, dy, sw, sh
      );

      ctx.restore();

      this.drawHpBar(ctx);
    }


    draw(ctx, game) {

      // Shield aura visualization (subtle ring)
      if (this.kind === "shield" && this.isAlive()) {
        const { cx, cy } = this.center();
        ctx.beginPath();
        ctx.strokeStyle = "rgba(0,0,0,0.10)";
        ctx.lineWidth = 2;
        ctx.arc(cx, cy, this.auraRadius, 0, Math.PI * 2);
        ctx.stroke();
      }

      if (SPRITES[this.kind]) {
        this.drawUnitSprite(ctx);
        return;
      }

      const alive = this.state !== "die";

      // Base colors (simple, no sprites)
      // Player: darker / Enemy: lighter (still readable on white)
      let fill = (this.team === "player") ? "#222" : "#777";

      // state-based tinting
      if (this.state === "attack") fill = (this.animFrame === 0) ? "#111" : "#444";
      if (this.state === "hit") fill = (this.animFrame === 0) ? "#999" : "#555";
      if (this.state === "move") fill = (this.animFrame === 0) ? fill : "#333";

      // distinguish unit types a bit (still squares)
      if (this.kind === "archer") fill = (this.team === "player") ? "#2a2a2a" : "#6a6a6a";
      if (this.kind === "horseman") fill = (this.team === "player") ? "#1b1b1b" : "#5e5e5e";
      if (this.kind === "shield") fill = (this.team === "player") ? "#000" : "#444";

      ctx.save();

      // Die animation: fade out
      if (!alive) {
        const alpha = clamp(this.deathTimer / DEATH_TIME, 0, 1);
        ctx.globalAlpha = alpha;
        fill = "#666";
      }

      // Unit square
      ctx.fillStyle = fill;
      ctx.fillRect(this.x, this.y, this.size, this.size);

      // HP bar
      this.drawHpBar(ctx);
      
      ctx.restore();
    }
  }

  class WaveSpawner {
    constructor(config) {
      this.baseWaves = config.waves.slice().sort((a, b) => a.t - b.t);
      this.loop = config.loop;
      this.loopAfter = config.loopAfter;
      this.reset();
    }

    reset() {
      this.time = 0;
      this.queue = this.expand(this.baseWaves);
      this.loopCount = 0;
    }

    expand(waves) {
      // Expand "count + spacing" into individual spawn events.
      const out = [];
      for (const w of waves) {
        const count = w.count ?? 1;
        const spacing = w.spacing ?? 0;
        for (let i = 0; i < count; i++) {
          out.push({ t: w.t + i * spacing, unit: w.unit });
        }
      }
      return out.sort((a, b) => a.t - b.t);
    }

    update(dt, game) {
      this.time += dt;

      // spawn due events
      while (this.queue.length > 0 && this.queue[0].t <= this.time) {
        const ev = this.queue.shift();
        game.spawnUnit("enemy", ev.unit);
      }

      if (this.loop && this.time >= this.loopAfter) {
        this.time = 0;
        this.queue = this.expand(this.baseWaves);
      }
    }
  }

  // =========================
  // Player
  // =========================
  class Player {
      constructor(baseCooldowns) {

        this.baseCooldowns = baseCooldowns;

        // Per-unit cooldown timers
        this.cooldowns = {
          knight: 0,
          archer: 0,
          horseman: 0,
          shield: 0
        };
      }

      getSpawnCooldown(unitType) {
        return  this.baseCooldowns[unitType];
      }

      update(dt) {
        for (const key in this.cooldowns) {
          this.cooldowns[key] = Math.max(0, this.cooldowns[key] - dt);
        }
      }

      canSpawn(unitType) {
        return this.cooldowns[unitType] <= 0;
      }

      triggerCooldown(unitType) {
        this.cooldowns[unitType] = this.getSpawnCooldown(unitType);
      }
    }

  // =========================
  // LevelManager
  // =========================
  class LevelManager {
    constructor(levels) {
      this.levels = levels;
      this.currentLevel = 1;
      this.maxLevel = Math.max(...Object.keys(levels).map(Number));
    }

    hasNextLevel() {
      return this.currentLevel < this.maxLevel;
    }

    getCurrentConfig() {
      return this.levels[this.currentLevel];
    }

    advanceLevel() {
      if (this.hasNextLevel()) {
        this.currentLevel++;
        return true;
      }
      return false;
    }
  }

  // =========================
  // Game
  // =========================
  class Game {
    constructor(levelsData, playerCooldowns) {
      this.units = [];
      this.projectiles = [];

      this.playerCastleHpMax = 600;
      this.enemyCastleHpMax = 600;
      this.playerCastleHp = this.playerCastleHpMax;
      this.enemyCastleHp = this.enemyCastleHpMax;

      this.player = new Player(playerCooldowns);

      this.playerCastleRect = {
        x: FIELD.padding,
        y: CASTLE.y,
        w: CASTLE.w,
        h: CASTLE.h,
      };
      this.enemyCastleRect = {
        x: FIELD.w - FIELD.padding - CASTLE.w,
        y: CASTLE.y,
        w: CASTLE.w,
        h: CASTLE.h,
      };

      this.levelManager = new LevelManager(levelsData);
      this.spawner = new WaveSpawner(this.levelManager.getCurrentConfig());
      
      this.matchTime = 0;
      this.gameOver = false;
      this.winner = null;

      this.levelBannerTimer = 0;
      this.levelBannerDuration = 2.0; // seconds

      this.showLevelBanner();
    }

    showLevelBanner() {
      this.levelBannerTimer = this.levelBannerDuration;
    }

    spawnUnit(team, kind) {
      if (this.gameOver) return;
      if (!UNIT_TEMPLATES[kind]) return;

      const spawnX = (team === "player")
        ? (this.playerCastleRect.x + this.playerCastleRect.w + 20)
        : (this.enemyCastleRect.x - 20 - UNIT_TEMPLATES[kind].size);

      this.units.push(new Unit({ team, kind, x: spawnX }));
    }

    update(dt) {
      if (this.gameOver) return;

      this.levelBannerTimer = Math.max(0, this.levelBannerTimer - dt);

      this.matchTime += dt;

      this.player.update(dt);

      // Enemy spawner
      this.spawner.update(dt, this);

      // Update units
      for (const u of this.units) u.update(dt, this);

      // Update projectiles
      for (const p of this.projectiles) p.update(dt, this);

      // Cleanup dead projectiles
      this.projectiles = this.projectiles.filter(p => !p.dead);

      // Remove fully dead units when their die timer ends
      this.units = this.units.filter(u => !(u.state === "die" && u.deathTimer <= 0));

      // Clamp castle HP
      this.playerCastleHp = clamp(this.playerCastleHp, 0, this.playerCastleHpMax);
      this.enemyCastleHp = clamp(this.enemyCastleHp, 0, this.enemyCastleHpMax);

      // Win/Lose
      if (this.playerCastleHp <= 0) {
        this.gameOver = true;
        this.winner = "enemy";
      }
      else
      {
        if (this.enemyCastleHp <= 0) {
          if (this.levelManager.advanceLevel()) {
            // Next level
            this.enemyCastleHp = this.enemyCastleHpMax;
            this.units = [];
            this.projectiles = [];

            this.spawner = new WaveSpawner(
              this.levelManager.getCurrentConfig()
            );

            this.showLevelBanner();
          } else {
            // Final victory
            this.gameOver = true;
            this.winner = "player";
          }
        }
      }
    }

    draw(ctx) {
      // Clear
      ctx.clearRect(0, 0, FIELD.w, FIELD.h);

      // Lane background stripe
      ctx.save();
      ctx.fillStyle = "rgba(0,0,0,0.03)";
      ctx.fillRect(0, FIELD.laneY - FIELD.laneH / 2, FIELD.w, FIELD.laneH);
      ctx.restore();

      // Castles
      this.drawCastle(ctx, this.playerCastleRect, "Player");
      this.drawCastle(ctx, this.enemyCastleRect, "Enemy");

      // Units
      for (const u of this.units) u.draw(ctx, this);

      // Projectiles
      for (const p of this.projectiles) p.draw(ctx);

      // HUD: castle life bars (simple)
      this.drawCastleLifeBar(ctx, this.playerCastleRect, this.playerCastleHp, this.playerCastleHpMax);
      this.drawCastleLifeBar(ctx, this.enemyCastleRect, this.enemyCastleHp, this.enemyCastleHpMax);

      // Game over overlay
      if (this.gameOver) {
        ctx.save();
        ctx.fillStyle = "rgba(255,255,255,0.75)";
        ctx.fillRect(0, 0, FIELD.w, FIELD.h);

        ctx.fillStyle = "#111";
        ctx.font = "bold 40px system-ui";
        ctx.textAlign = "center";
        ctx.fillText(
          this.winner === "player" ? "YOU WIN" : "YOU LOSE",
          FIELD.w / 2,
          FIELD.h / 2
        );

        ctx.font = "16px system-ui";
        ctx.fillText("Refresh to restart (for now).", FIELD.w / 2, FIELD.h / 2 + 40);
        ctx.restore();
      }

      // Level banner
      if (this.levelBannerTimer > 0) {
        ctx.save();
        ctx.globalAlpha = Math.min(this.levelBannerTimer, 1);
        ctx.fillStyle = "rgba(255,255,255,0.85)";
        ctx.fillRect(0, 0, FIELD.w, FIELD.h);

        ctx.fillStyle = "#111";
        ctx.font = "bold 48px system-ui";
        ctx.textAlign = "center";
        ctx.fillText(
          `LEVEL ${this.levelManager.currentLevel}`,
          FIELD.w / 2,
          FIELD.h / 2
        );

        ctx.restore();
    }
  }

    drawCastle(ctx, r, label) {
      ctx.save();
      ctx.strokeStyle = "#111";
      ctx.lineWidth = 3;
      ctx.strokeRect(r.x, r.y, r.w, r.h);

      // roof
      ctx.beginPath();
      ctx.moveTo(r.x, r.y);
      ctx.lineTo(r.x + r.w / 2, r.y - 55);
      ctx.lineTo(r.x + r.w, r.y);
      ctx.closePath();
      ctx.stroke();

      // label
      ctx.fillStyle = "#111";
      ctx.font = "bold 18px system-ui";
      ctx.textAlign = "center";
      ctx.fillText(label + " Castle", r.x + r.w / 2, r.y - 70);

      ctx.restore();
    }

    drawCastleLifeBar(ctx, r, hp, hpMax) {
      const barW = 170;
      const barH = 16;
      const x = r.x + (r.w - barW) / 2;
      const y = r.y + r.h + 14;

      const pct = hp / hpMax;

      ctx.save();
      ctx.fillStyle = "#fff";
      ctx.strokeStyle = "#111";
      ctx.lineWidth = 3;
      ctx.fillRect(x, y, barW, barH);
      ctx.strokeRect(x, y, barW, barH);

      ctx.fillStyle = "#111";
      ctx.fillRect(x, y, barW * pct, barH);

      ctx.restore();
    }
  }

  // =========================
  // Boot
  // =========================
  (async function start() {
    const data = await loadLevelsFromXML("MultipleLevels.xml");
    const game = new Game(data.levels, data.playerCooldowns);

    window.game = game;
    startLoop(game);
  })();

  function updateHud() {
    uiPlayerHp.textContent = Math.round(game.playerCastleHp);
    uiEnemyHp.textContent = Math.round(game.enemyCastleHp);
  }

  function updateButtons() {
    document.querySelectorAll(".spawn-btn").forEach(btn => {
      const kind = btn.getAttribute("data-unit");
      const cd = game.player.cooldowns[kind];
      const max = game.player.getSpawnCooldown(kind);

      const bar = btn.querySelector(".cooldown-bar");
      const label = btn.querySelector(".label");

      if (cd > 0) {
        btn.disabled = true;

        const progress = 1 - cd / max;
        bar.style.width = `${progress * 100}%`;

      } else {
        btn.disabled = false;
        bar.style.width = "0%";
      }

      // Label stays constant (no jitter)
      label.textContent = `Deploy ${kind.charAt(0).toUpperCase() + kind.slice(1)}`;
    });
  }

  // Controls
  document.querySelectorAll("button[data-unit]").forEach(btn => {
    btn.addEventListener("click", () => {
      const kind = btn.getAttribute("data-unit");

      if (!game.player.canSpawn(kind)) return;

      game.spawnUnit("player", kind);
      game.player.triggerCooldown(kind);
    });
  });

  function startLoop(game) {
    let last = performance.now() / 1000;
    let acc = 0;

    function frame() {
      const now = performance.now() / 1000;
      let dt = now - last;
      last = now;

      dt = clamp(dt, 0, MAX_CATCHUP);
      acc += dt;

      while (acc >= FIXED_DT) {
        game.update(FIXED_DT);
        acc -= FIXED_DT;
      }

      game.draw(ctx);
      updateHud();
      updateButtons();

      requestAnimationFrame(frame);
    }

    requestAnimationFrame(frame);
  }

})();
