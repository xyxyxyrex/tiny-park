import { LEVEL, PLAYER_COLORS } from './levels.js';

const Matter = window.Matter;
const { Engine, Bodies, Body, Composite, Query } = Matter || {};

const PLAYER_W = 34;
const PLAYER_H = 44;
const MOVE_SPEED = 4.4;
const JUMP_SPEED = 11.5;
const SNAPSHOT_INTERVAL = 50;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function distanceSquared(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

export class TinyParkGame extends EventTarget {
  constructor(canvas, network) {
    super();
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.network = network;
    this.mode = null;
    this.localPlayerId = null;
    this.hostPlayerId = 'host';
    this.players = new Map();
    this.remoteInputs = new Map();
    this.localInput = { left: false, right: false, jump: false };
    this.lastJumpPressed = false;
    this.keyCollected = false;
    this.won = false;
    this.running = false;
    this.animationFrame = 0;
    this.lastFrameAt = 0;
    this.lastSnapshotAt = 0;
    this.engine = null;
    this.staticBodies = [];
    this.crateBody = null;
    this.networkListeners = [];
    this.clientState = {
      players: [],
      crate: null,
      keyCollected: false,
      won: false,
    };
    this.#bindInput();
  }

  startHost(name) {
    this.stop();
    this.mode = 'host';
    this.localPlayerId = this.hostPlayerId;
    this.#initWorld();
    this.#addHostPlayer(name || 'Host');
    this.#bindNetwork();
    this.running = true;
    this.lastFrameAt = performance.now();
    this.animationFrame = requestAnimationFrame((time) => this.#loop(time));
  }

  startClient(name) {
    this.stop();
    this.mode = 'client';
    this.localPlayerId = null;
    this.clientName = name || 'Player';
    this.#bindNetwork();
    this.running = true;
    this.lastFrameAt = performance.now();
    this.animationFrame = requestAnimationFrame((time) => this.#loop(time));
    this.network.sendToHost({ type: 'hello', name: this.clientName });
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this.animationFrame);
    this.animationFrame = 0;
    for (const [target, type, fn] of this.networkListeners) target.removeEventListener(type, fn);
    this.networkListeners = [];
    this.players.clear();
    this.remoteInputs.clear();
    this.engine = null;
    this.staticBodies = [];
    this.crateBody = null;
    this.keyCollected = false;
    this.won = false;
  }

  #bindNetwork() {
    const on = (type, fn) => {
      this.network.addEventListener(type, fn);
      this.networkListeners.push([this.network, type, fn]);
    };

    if (this.mode === 'host') {
      on('client-connected', (event) => {
        this.dispatchEvent(new CustomEvent('players-changed', { detail: { count: this.players.size } }));
      });

      on('client-data', (event) => {
        const { peerId, data } = event.detail;
        this.#handleClientMessage(peerId, data);
      });

      on('client-disconnected', (event) => {
        const { peerId } = event.detail;
        this.#removePlayer(peerId);
      });
    } else {
      on('host-data', (event) => this.#handleHostMessage(event.detail.data));
      on('network-status', (event) => {
        if (event.detail.state === 'closed') this.dispatchEvent(new CustomEvent('disconnected'));
      });
    }
  }

  #initWorld() {
    if (!Matter) throw new Error('Matter.js failed to load.');
    this.engine = Engine.create({ enableSleeping: false });
    this.engine.gravity.y = 1.05;

    this.staticBodies = LEVEL.platforms.map((platform) => {
      const body = Bodies.rectangle(
        platform.x + platform.w / 2,
        platform.y + platform.h / 2,
        platform.w,
        platform.h,
        { isStatic: true, friction: 0.8 }
      );
      Composite.add(this.engine.world, body);
      return body;
    });

    const leftWall = Bodies.rectangle(-25, LEVEL.height / 2, 50, LEVEL.height * 2, { isStatic: true });
    const rightWall = Bodies.rectangle(LEVEL.width + 25, LEVEL.height / 2, 50, LEVEL.height * 2, { isStatic: true });
    Composite.add(this.engine.world, [leftWall, rightWall]);

    this.crateBody = Bodies.rectangle(
      LEVEL.crate.x,
      LEVEL.crate.y,
      LEVEL.crate.w,
      LEVEL.crate.h,
      { density: 0.0014, friction: 0.8, restitution: 0, inertia: Infinity }
    );
    Composite.add(this.engine.world, this.crateBody);
  }

  #addHostPlayer(name) {
    const player = this.#createPlayer(this.hostPlayerId, name, 0);
    this.players.set(this.hostPlayerId, player);
  }

  #createPlayer(id, name, colorIndex) {
    const offset = this.players.size * 42;
    const body = Bodies.rectangle(
      LEVEL.spawn.x + offset,
      LEVEL.spawn.y - offset * 0.3,
      PLAYER_W,
      PLAYER_H,
      {
        friction: 0,
        frictionAir: 0,
        restitution: 0,
        inertia: Infinity,
        density: 0.001,
        label: `player:${id}`,
      }
    );
    Composite.add(this.engine.world, body);
    return {
      id,
      name: String(name || 'Player').slice(0, 16),
      color: PLAYER_COLORS[colorIndex % PLAYER_COLORS.length],
      body,
      jumpLatch: false,
    };
  }

  #removePlayer(id) {
    const player = this.players.get(id);
    if (!player) return;
    Composite.remove(this.engine.world, player.body);
    this.players.delete(id);
    this.remoteInputs.delete(id);
    this.dispatchEvent(new CustomEvent('players-changed', { detail: { count: this.players.size } }));
  }

  #handleClientMessage(peerId, data) {
    if (!data || typeof data !== 'object') return;

    if (data.type === 'hello') {
      if (!this.players.has(peerId)) {
        if (this.players.size >= PLAYER_COLORS.length) {
          this.network.sendTo(peerId, { type: 'reject', reason: 'Room is full.' });
          return;
        }
        const player = this.#createPlayer(peerId, data.name, this.players.size);
        this.players.set(peerId, player);
        this.remoteInputs.set(peerId, { left: false, right: false, jump: false });
        this.dispatchEvent(new CustomEvent('players-changed', { detail: { count: this.players.size } }));
      }
      this.network.sendTo(peerId, { type: 'welcome', playerId: peerId });
      this.#sendSnapshot(true);
      return;
    }

    if (data.type === 'input' && this.players.has(peerId)) {
      this.remoteInputs.set(peerId, {
        left: Boolean(data.input?.left),
        right: Boolean(data.input?.right),
        jump: Boolean(data.input?.jump),
      });
    }
  }

  #handleHostMessage(data) {
    if (!data || typeof data !== 'object') return;
    if (data.type === 'welcome') {
      this.localPlayerId = data.playerId;
      return;
    }
    if (data.type === 'reject') {
      this.dispatchEvent(new CustomEvent('rejected', { detail: { reason: data.reason } }));
      return;
    }
    if (data.type === 'snapshot') {
      this.clientState = data.state;
      this.keyCollected = Boolean(data.state.keyCollected);
      const justWon = !this.won && Boolean(data.state.won);
      this.won = Boolean(data.state.won);
      this.dispatchEvent(new CustomEvent('players-changed', { detail: { count: data.state.players.length } }));
      if (justWon) this.dispatchEvent(new CustomEvent('won'));
    }
  }

  #bindInput() {
    const tracked = new Set(['KeyA', 'KeyD', 'KeyW', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'Space']);

    window.addEventListener('keydown', (event) => {
      if (!tracked.has(event.code)) return;
      event.preventDefault();
      this.#setInputFromKey(event.code, true);
    });

    window.addEventListener('keyup', (event) => {
      if (!tracked.has(event.code)) return;
      event.preventDefault();
      this.#setInputFromKey(event.code, false);
    });

    window.addEventListener('blur', () => {
      this.localInput = { left: false, right: false, jump: false };
      this.#sendInput();
    });
  }

  #setInputFromKey(code, value) {
    if (code === 'KeyA' || code === 'ArrowLeft') this.localInput.left = value;
    if (code === 'KeyD' || code === 'ArrowRight') this.localInput.right = value;
    if (code === 'KeyW' || code === 'ArrowUp' || code === 'Space') this.localInput.jump = value;
    this.#sendInput();
  }

  #sendInput() {
    if (!this.running) return;
    if (this.mode === 'client') {
      this.network.sendToHost({ type: 'input', input: this.localInput });
    }
  }

  #loop(time) {
    if (!this.running) return;
    const delta = clamp(time - this.lastFrameAt, 0, 33.333);
    this.lastFrameAt = time;

    if (this.mode === 'host') {
      this.#stepHost(delta);
      if (time - this.lastSnapshotAt >= SNAPSHOT_INTERVAL) {
        this.#sendSnapshot();
        this.lastSnapshotAt = time;
      }
      this.#renderHost();
    } else {
      this.#renderClient();
    }

    this.animationFrame = requestAnimationFrame((next) => this.#loop(next));
  }

  #stepHost(delta) {
    for (const [id, player] of this.players) {
      const input = id === this.hostPlayerId ? this.localInput : (this.remoteInputs.get(id) || {});
      this.#applyPlayerInput(player, input);
    }

    Engine.update(this.engine, delta || 16.667);

    for (const player of this.players.values()) {
      Body.setAngle(player.body, 0);
      Body.setAngularVelocity(player.body, 0);
      if (player.body.position.y > LEVEL.height + 180) this.#respawn(player);
    }

    if (!this.keyCollected) {
      for (const player of this.players.values()) {
        if (distanceSquared(player.body.position, LEVEL.key) < 34 * 34) {
          this.keyCollected = true;
          break;
        }
      }
    }

    if (this.keyCollected && !this.won && this.players.size > 0) {
      const allInside = [...this.players.values()].every((player) => {
        const p = player.body.position;
        return p.x > LEVEL.exit.x && p.x < LEVEL.exit.x + LEVEL.exit.w && p.y > LEVEL.exit.y;
      });
      if (allInside) {
        this.won = true;
        this.dispatchEvent(new CustomEvent('won'));
      }
    }
  }

  #applyPlayerInput(player, input) {
    const body = player.body;
    let vx = 0;
    if (input.left && !input.right) vx = -MOVE_SPEED;
    if (input.right && !input.left) vx = MOVE_SPEED;
    Body.setVelocity(body, { x: vx, y: body.velocity.y });

    if (input.jump && !player.jumpLatch && this.#isGrounded(player)) {
      Body.setVelocity(body, { x: body.velocity.x, y: -JUMP_SPEED });
    }
    player.jumpLatch = Boolean(input.jump);
  }

  #isGrounded(player) {
    const p = player.body.position;
    const sensor = Bodies.rectangle(p.x, p.y + PLAYER_H / 2 + 3, PLAYER_W * 0.72, 7, { isSensor: true });
    const candidates = [
      ...this.staticBodies,
      this.crateBody,
      ...[...this.players.values()].filter((other) => other.id !== player.id).map((other) => other.body),
    ];
    return Query.collides(sensor, candidates).length > 0;
  }

  #respawn(player) {
    Body.setPosition(player.body, {
      x: LEVEL.spawn.x + Math.random() * 20,
      y: LEVEL.spawn.y - 120,
    });
    Body.setVelocity(player.body, { x: 0, y: 0 });
  }

  #sendSnapshot(force = false) {
    if (this.mode !== 'host') return;
    const state = this.#serializeState();
    if (force) this.network.broadcast({ type: 'snapshot', state });
    else this.network.broadcast({ type: 'snapshot', state });
  }

  #serializeState() {
    return {
      players: [...this.players.values()].map((player) => ({
        id: player.id,
        name: player.name,
        color: player.color,
        x: player.body.position.x,
        y: player.body.position.y,
        vx: player.body.velocity.x,
        vy: player.body.velocity.y,
      })),
      crate: this.crateBody ? { x: this.crateBody.position.x, y: this.crateBody.position.y, angle: this.crateBody.angle } : null,
      keyCollected: this.keyCollected,
      won: this.won,
    };
  }

  #renderHost() {
    this.#render(this.#serializeState());
  }

  #renderClient() {
    this.#render(this.clientState);
  }

  #render(state) {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, LEVEL.width, LEVEL.height);

    ctx.fillStyle = '#e8e2d7';
    ctx.fillRect(0, 0, LEVEL.width, LEVEL.height);

    this.#drawBackdrop(ctx);

    ctx.fillStyle = '#272727';
    for (const p of LEVEL.platforms) ctx.fillRect(p.x, p.y, p.w, p.h);

    if (state.crate) {
      ctx.save();
      ctx.translate(state.crate.x, state.crate.y);
      ctx.rotate(state.crate.angle || 0);
      ctx.fillStyle = '#8d6748';
      ctx.fillRect(-LEVEL.crate.w / 2, -LEVEL.crate.h / 2, LEVEL.crate.w, LEVEL.crate.h);
      ctx.strokeStyle = '#272727';
      ctx.lineWidth = 4;
      ctx.strokeRect(-LEVEL.crate.w / 2, -LEVEL.crate.h / 2, LEVEL.crate.w, LEVEL.crate.h);
      ctx.restore();
    }

    this.#drawExit(ctx, Boolean(state.keyCollected));
    if (!state.keyCollected) this.#drawKey(ctx);

    for (const player of state.players || []) this.#drawPlayer(ctx, player, player.id === this.localPlayerId);

    if (!state.keyCollected) {
      ctx.fillStyle = '#6f675e';
      ctx.font = '700 15px Arial';
      ctx.fillText('KEY', LEVEL.key.x - 18, LEVEL.key.y - 28);
    }
  }

  #drawBackdrop(ctx) {
    ctx.strokeStyle = 'rgba(21,21,21,0.08)';
    ctx.lineWidth = 1;
    for (let x = 0; x <= LEVEL.width; x += 40) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, LEVEL.height);
      ctx.stroke();
    }
    for (let y = 0; y <= LEVEL.height; y += 40) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(LEVEL.width, y);
      ctx.stroke();
    }
  }

  #drawPlayer(ctx, player, isLocal) {
    const x = player.x;
    const y = player.y;
    ctx.fillStyle = player.color || '#222';
    ctx.fillRect(x - PLAYER_W / 2, y - PLAYER_H / 2, PLAYER_W, PLAYER_H);

    ctx.fillStyle = '#151515';
    ctx.fillRect(x - 8, y - 8, 5, 5);
    ctx.fillRect(x + 4, y - 8, 5, 5);

    if (isLocal) {
      ctx.strokeStyle = '#151515';
      ctx.lineWidth = 3;
      ctx.strokeRect(x - PLAYER_W / 2 - 4, y - PLAYER_H / 2 - 4, PLAYER_W + 8, PLAYER_H + 8);
    }

    ctx.fillStyle = '#151515';
    ctx.font = '700 13px Arial';
    ctx.textAlign = 'center';
    ctx.fillText(player.name || 'Player', x, y - PLAYER_H / 2 - 12);
    ctx.textAlign = 'left';
  }

  #drawKey(ctx) {
    const { x, y, radius } = LEVEL.key;
    ctx.fillStyle = '#f9c74f';
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillRect(x + radius - 2, y - 4, 32, 8);
    ctx.fillRect(x + 32, y - 4, 7, 17);
    ctx.strokeStyle = '#272727';
    ctx.lineWidth = 4;
    ctx.stroke();
  }

  #drawExit(ctx, open) {
    const exit = LEVEL.exit;
    ctx.fillStyle = open ? '#43aa8b' : '#777069';
    ctx.fillRect(exit.x, exit.y, exit.w, exit.h);
    ctx.strokeStyle = '#272727';
    ctx.lineWidth = 5;
    ctx.strokeRect(exit.x, exit.y, exit.w, exit.h);
    ctx.fillStyle = '#272727';
    ctx.beginPath();
    ctx.arc(exit.x + exit.w - 18, exit.y + exit.h / 2, 5, 0, Math.PI * 2);
    ctx.fill();
    if (!open) {
      ctx.fillStyle = '#f4efe6';
      ctx.font = '900 20px Arial';
      ctx.textAlign = 'center';
      ctx.fillText('LOCKED', exit.x + exit.w / 2, exit.y - 14);
      ctx.textAlign = 'left';
    }
  }
}
