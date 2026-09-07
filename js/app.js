import { RoomNetwork, cleanCode } from './network.js';
import { TinyParkGame } from './game.js';

const lobby = document.querySelector('#lobby');
const gameScreen = document.querySelector('#game-screen');
const nameInput = document.querySelector('#player-name');
const roomInput = document.querySelector('#room-code');
const createButton = document.querySelector('#create-room');
const joinButton = document.querySelector('#join-room');
const status = document.querySelector('#lobby-status');
const roomButton = document.querySelector('#copy-room');
const connectionState = document.querySelector('#connection-state');
const playerCount = document.querySelector('#player-count');
const leaveButton = document.querySelector('#leave-room');
const gameMessage = document.querySelector('#game-message');
const canvas = document.querySelector('#game-canvas');

const network = new RoomNetwork();
const game = new TinyParkGame(canvas, network);

nameInput.value = localStorage.getItem('tinypark:name') || '';
roomInput.addEventListener('input', () => { roomInput.value = cleanCode(roomInput.value); });

createButton.addEventListener('click', createRoom);
joinButton.addEventListener('click', joinRoom);
roomInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') joinRoom();
});
leaveButton.addEventListener('click', leaveRoom);
roomButton.addEventListener('click', copyRoomCode);

network.addEventListener('network-error', (event) => {
  console.error(event.detail.error);
});

game.addEventListener('players-changed', (event) => updatePlayerCount(event.detail.count));
game.addEventListener('won', () => showGameMessage('ROOM CLEARED'));
game.addEventListener('rejected', (event) => showGameMessage(event.detail.reason || 'ROOM REJECTED'));
game.addEventListener('disconnected', () => {
  connectionState.textContent = 'DISCONNECTED';
  connectionState.style.color = '#a71d1d';
  showGameMessage('HOST DISCONNECTED');
});

async function createRoom() {
  setBusy(true);
  setStatus('Creating a WebRTC room…');
  try {
    const name = saveName();
    const code = await network.host();
    enterGame(code, 'HOST');
    game.startHost(name);
    updatePlayerCount(1);
  } catch (error) {
    console.error(error);
    setStatus(humanizeError(error), true);
    network.destroy();
  } finally {
    setBusy(false);
  }
}

async function joinRoom() {
  const code = cleanCode(roomInput.value);
  if (!code) {
    setStatus('Enter the room code from the host.', true);
    return;
  }

  setBusy(true);
  setStatus(`Joining ${code}…`);
  try {
    const name = saveName();
    await network.join(code);
    enterGame(code, 'CONNECTED');
    game.startClient(name);
  } catch (error) {
    console.error(error);
    setStatus(humanizeError(error), true);
    network.destroy();
  } finally {
    setBusy(false);
  }
}

function enterGame(code, state) {
  lobby.classList.add('is-hidden');
  gameScreen.classList.remove('is-hidden');
  roomButton.textContent = code;
  connectionState.textContent = state;
  connectionState.style.color = '#31733d';
  hideGameMessage();
}

function leaveRoom() {
  game.stop();
  network.destroy();
  gameScreen.classList.add('is-hidden');
  lobby.classList.remove('is-hidden');
  roomInput.value = '';
  setStatus('');
}

async function copyRoomCode() {
  const code = roomButton.textContent.trim();
  if (!code || code === '-----') return;
  try {
    await navigator.clipboard.writeText(code);
    const previous = roomButton.textContent;
    roomButton.textContent = 'COPIED';
    setTimeout(() => { roomButton.textContent = previous; }, 900);
  } catch {
    // Clipboard permissions can be unavailable in some browsers; the code remains selectable on screen.
  }
}

function updatePlayerCount(count) {
  playerCount.textContent = `${count} ${count === 1 ? 'PLAYER' : 'PLAYERS'}`;
}

function saveName() {
  const name = nameInput.value.trim().slice(0, 16) || 'Player';
  localStorage.setItem('tinypark:name', name);
  return name;
}

function setBusy(busy) {
  createButton.disabled = busy;
  joinButton.disabled = busy;
}

function setStatus(message, isError = false) {
  status.textContent = message;
  status.classList.toggle('is-error', isError);
}

function showGameMessage(message) {
  gameMessage.textContent = message;
  gameMessage.classList.remove('is-hidden');
}

function hideGameMessage() {
  gameMessage.textContent = '';
  gameMessage.classList.add('is-hidden');
}

function humanizeError(error) {
  if (error?.type === 'peer-unavailable') return 'Room not found. Check the code and try again.';
  if (error?.type === 'network') return 'Could not reach the PeerJS signaling service.';
  if (error?.message) return error.message;
  return 'Could not connect. Try again.';
}
