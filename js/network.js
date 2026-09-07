const ROOM_PREFIX = 'tinypark-';
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function makeCode(length = 5) {
  let result = '';
  crypto.getRandomValues(new Uint32Array(length)).forEach((value) => {
    result += ALPHABET[value % ALPHABET.length];
  });
  return result;
}

function cleanCode(value) {
  return value.toUpperCase().replace(/[^A-Z2-9]/g, '').slice(0, 6);
}

export class RoomNetwork extends EventTarget {
  constructor() {
    super();
    this.peer = null;
    this.connections = new Map();
    this.mode = null;
    this.roomCode = null;
    this.hostConnection = null;
  }

  async host() {
    this.destroy();
    this.mode = 'host';

    for (let attempt = 0; attempt < 8; attempt += 1) {
      const code = makeCode();
      try {
        await this.#openHostPeer(code);
        this.roomCode = code;
        return code;
      } catch (error) {
        if (error?.type !== 'unavailable-id') throw error;
      }
    }

    throw new Error('Could not reserve a room code. Try again.');
  }

  async join(code) {
    this.destroy();
    this.mode = 'client';
    this.roomCode = cleanCode(code);
    if (!this.roomCode) throw new Error('Enter a valid room code.');

    const Peer = window.Peer;
    if (!Peer) throw new Error('PeerJS failed to load.');

    this.peer = new Peer(undefined, { debug: 1 });

    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Peer service timed out.')), 10000);
      this.peer.once('open', () => {
        clearTimeout(timer);
        resolve();
      });
      this.peer.once('error', (error) => {
        clearTimeout(timer);
        reject(error);
      });
    });

    const conn = this.peer.connect(`${ROOM_PREFIX}${this.roomCode}`, {
      reliable: true,
      serialization: 'json',
    });
    this.hostConnection = conn;

    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Room not found or connection timed out.')), 10000);
      conn.once('open', () => {
        clearTimeout(timer);
        this.#wireClientConnection(conn);
        resolve();
      });
      conn.once('error', (error) => {
        clearTimeout(timer);
        reject(error);
      });
      conn.once('close', () => {
        clearTimeout(timer);
      });
    });
  }

  sendToHost(payload) {
    if (this.hostConnection?.open) this.hostConnection.send(payload);
  }

  sendTo(peerId, payload) {
    const connection = this.connections.get(peerId);
    if (connection?.open) connection.send(payload);
  }

  broadcast(payload) {
    for (const connection of this.connections.values()) {
      if (connection.open) connection.send(payload);
    }
  }

  destroy() {
    for (const connection of this.connections.values()) connection.close();
    this.connections.clear();
    this.hostConnection?.close();
    this.hostConnection = null;
    this.peer?.destroy();
    this.peer = null;
    this.mode = null;
    this.roomCode = null;
  }

  async #openHostPeer(code) {
    const Peer = window.Peer;
    if (!Peer) throw new Error('PeerJS failed to load.');

    const peer = new Peer(`${ROOM_PREFIX}${code}`, { debug: 1 });
    this.peer = peer;

    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Peer service timed out.')), 10000);
      peer.once('open', () => {
        clearTimeout(timer);
        resolve();
      });
      peer.once('error', (error) => {
        clearTimeout(timer);
        reject(error);
      });
    });

    peer.on('connection', (connection) => this.#wireHostConnection(connection));
    peer.on('disconnected', () => this.#emit('network-status', { state: 'disconnected' }));
    peer.on('error', (error) => this.#emit('network-error', { error }));
  }

  #wireHostConnection(connection) {
    connection.on('open', () => {
      this.connections.set(connection.peer, connection);
      this.#emit('client-connected', { peerId: connection.peer });
    });

    connection.on('data', (data) => {
      this.#emit('client-data', { peerId: connection.peer, data });
    });

    connection.on('close', () => {
      this.connections.delete(connection.peer);
      this.#emit('client-disconnected', { peerId: connection.peer });
    });

    connection.on('error', (error) => this.#emit('network-error', { error }));
  }

  #wireClientConnection(connection) {
    connection.on('data', (data) => this.#emit('host-data', { data }));
    connection.on('close', () => this.#emit('network-status', { state: 'closed' }));
    connection.on('error', (error) => this.#emit('network-error', { error }));
  }

  #emit(type, detail) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }
}

export { cleanCode };
