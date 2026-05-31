// Peer-to-peer book transfer over a WebRTC data channel.
//
// When someone joins a sync from the library for a book they don't have, the
// book's content is streamed directly device-to-device. Firebase is used only
// for signalling (SDP offer/answer + ICE candidates), written under the room's
// `signal` node; the book bytes themselves never touch Firebase.
//
// The joiner (receiver) initiates: it creates the offer and the data channel,
// and the room creator (holder), who is sitting in the reader with the book
// open, answers and streams the .vorlese bundle. Both peers are expected to be
// online at the same time and in the foreground (see ADR 0005); if the holder
// is offline or a direct connection can't be made, receiveBook() rejects and
// the caller surfaces a "partner must be online" message.

// STUN only, by design: no TURN relay. A direct connection works for the
// common case (both partners on home Wi-Fi); on strict/symmetric NATs it may
// fail, which we treat the same as the partner being offline.
const ICE_SERVERS = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }];

const CHUNK_SIZE = 16 * 1024;          // conservative, cross-browser-safe message size
const MAX_BUFFERED = 1 << 20;          // pause sending above 1 MB queued
const BUFFER_LOW = 256 * 1024;         // resume once the queue drains to here
const TRANSFER_TIMEOUT_MS = 25000;     // give up if no connection / no progress

function randomId() {
  return Math.random().toString(36).slice(2, 10);
}

function toPayload(candidate, from) {
  const payload = { from, candidate: candidate.candidate };
  if (candidate.sdpMid != null) payload.sdpMid = candidate.sdpMid;
  if (candidate.sdpMLineIndex != null) payload.sdpMLineIndex = candidate.sdpMLineIndex;
  return payload;
}

function fromPayload(v) {
  return {
    candidate: v.candidate,
    sdpMid: v.sdpMid ?? null,
    sdpMLineIndex: v.sdpMLineIndex ?? null,
  };
}

function waitForDrain(channel) {
  return new Promise((resolve) => {
    if (channel.readyState !== 'open' || channel.bufferedAmount <= channel.bufferedAmountLowThreshold) {
      resolve();
      return;
    }
    const done = () => {
      channel.removeEventListener('bufferedamountlow', done);
      channel.removeEventListener('close', done);
      channel.removeEventListener('error', done);
      resolve();
    };
    // Resolve on close/error too, so the send loop never hangs waiting for a
    // drain event that can no longer come (the loop then sees readyState and exits).
    channel.addEventListener('bufferedamountlow', done);
    channel.addEventListener('close', done);
    channel.addEventListener('error', done);
  });
}

// Receiver side. Returns the received .vorlese bundle as a Blob, or rejects.
export function receiveBook(fb, roomCode, { onProgress } = {}) {
  const myId = randomId();
  const signalRef = (path) => fb.ref(fb.db, `rooms/${roomCode}/signal${path}`);

  return new Promise((resolve, reject) => {
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    const channel = pc.createDataChannel('book');
    channel.binaryType = 'arraybuffer';

    const subscriptions = [];
    let settled = false;
    let remoteSet = false;
    const pendingIce = [];
    let expected = 0;
    let received = 0;
    const chunks = [];

    // An idle timeout, not a total one: it fires only if nothing happens for
    // TRANSFER_TIMEOUT_MS, so a large but actively-progressing book is never
    // cut off, while an offline partner (no data ever arrives) still fails.
    let timer = setTimeout(() => fail(new Error('timeout')), TRANSFER_TIMEOUT_MS);
    const pokeTimer = () => {
      clearTimeout(timer);
      timer = setTimeout(() => fail(new Error('timeout')), TRANSFER_TIMEOUT_MS);
    };

    function teardown() {
      clearTimeout(timer);
      for (const off of subscriptions) {
        try { off(); } catch {}
      }
      try { channel.close(); } catch {}
      try { pc.close(); } catch {}
      // Leave the slate clean for any later attempt in the same room.
      fb.remove(signalRef('')).catch(() => {});
    }

    function fail(err) {
      if (settled) return;
      settled = true;
      teardown();
      reject(err);
    }

    function succeed(blob) {
      if (settled) return;
      settled = true;
      teardown();
      resolve(blob);
    }

    pc.onicecandidate = (e) => {
      if (!e.candidate) return;
      fb.push(signalRef('/ice'), toPayload(e.candidate, myId)).catch(() => {});
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed') fail(new Error('connection-failed'));
    };

    channel.onmessage = (e) => {
      pokeTimer();
      if (typeof e.data === 'string') {
        let msg;
        try { msg = JSON.parse(e.data); } catch { return; }
        if (msg.type === 'meta') {
          expected = msg.size;
          onProgress?.(0);
        } else if (msg.type === 'done') {
          if (!expected || received < expected) fail(new Error('incomplete'));
          else succeed(new Blob(chunks));
        }
        return;
      }
      chunks.push(e.data);
      received += e.data.byteLength;
      if (expected) onProgress?.(Math.min(received / expected, 1));
    };
    channel.onerror = () => fail(new Error('channel-error'));
    // If the holder closes the channel (e.g. it hit an error mid-send), fail
    // immediately rather than waiting out the idle timeout.
    channel.onclose = () => fail(new Error('channel-closed'));

    // Holder's answer.
    const offAnswer = fb.onValue(signalRef('/answer'), async (snap) => {
      const a = snap.val();
      // Guard on signalingState too: a stale answer left in the room would
      // otherwise be applied while we're still in 'stable' and throw.
      if (!a || !a.sdp || remoteSet || pc.signalingState !== 'have-local-offer') return;
      remoteSet = true;
      try {
        await pc.setRemoteDescription({ type: 'answer', sdp: a.sdp });
        for (const c of pendingIce) await pc.addIceCandidate(c).catch(() => {});
        pendingIce.length = 0;
      } catch (err) {
        fail(err);
      }
    });
    subscriptions.push(offAnswer);

    // Holder's ICE candidates (ignore our own echoes). Queue until the remote
    // description is actually applied — addIceCandidate throws before then.
    const offIce = fb.onChildAdded(signalRef('/ice'), (snap) => {
      const v = snap.val();
      if (!v || v.from === myId) return;
      const candidate = fromPayload(v);
      if (!pc.remoteDescription) pendingIce.push(candidate);
      else pc.addIceCandidate(candidate).catch(() => {});
    });
    subscriptions.push(offIce);

    // Clear any stale handshake, then publish our offer.
    fb.remove(signalRef(''))
      .catch(() => {})
      .then(() => pc.createOffer())
      .then((offer) => pc.setLocalDescription(offer).then(() => offer))
      .then((offer) => fb.set(signalRef('/offer'), { from: myId, sdp: offer.sdp }))
      .catch((err) => fail(err));
  });
}

// Holder side. Listens for join requests and streams the book to each one.
// Returns a stop() function that tears down the listener and the active peer.
export function serveBook(fb, roomCode, getBundle) {
  const myId = `h${randomId()}`;
  const handled = new Set();
  const signalRef = (path) => fb.ref(fb.db, `rooms/${roomCode}/signal${path}`);
  let active = null;

  function closeActive() {
    if (!active) return;
    try { active.offIce?.(); } catch {}
    try { active.pc.close(); } catch {}
    active = null;
  }

  async function sendBundle(channel) {
    try {
      const { blob } = await getBundle();
      channel.send(JSON.stringify({ type: 'meta', size: blob.size }));
      let offset = 0;
      while (offset < blob.size) {
        if (channel.bufferedAmount > MAX_BUFFERED) await waitForDrain(channel);
        if (channel.readyState !== 'open') return;
        const end = Math.min(offset + CHUNK_SIZE, blob.size);
        // Slice lazily so only one chunk is in memory at a time, instead of
        // loading the whole bundle into a single ArrayBuffer (OOM risk on the
        // mobile devices this app targets). Each slice is its own buffer, so no
        // backing-buffer-inflation worry either.
        channel.send(await blob.slice(offset, end).arrayBuffer());
        offset = end;
      }
      // The channel is ordered + reliable, so the chunks are delivered before
      // this marker even if some are still queued locally.
      channel.send(JSON.stringify({ type: 'done' }));
    } catch {
      // Close so the receiver fails fast instead of waiting out its idle timeout.
      try { channel.close(); } catch {}
    }
  }

  async function handleOffer(offer) {
    closeActive();
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    const ctx = { pc, offIce: null };
    active = ctx;
    const pendingIce = [];

    pc.onicecandidate = (e) => {
      if (!e.candidate) return;
      fb.push(signalRef('/ice'), toPayload(e.candidate, myId)).catch(() => {});
    };

    pc.ondatachannel = (e) => {
      const channel = e.channel;
      channel.binaryType = 'arraybuffer';
      channel.bufferedAmountLowThreshold = BUFFER_LOW;
      // The channel can already be open by the time this fires; don't miss it.
      if (channel.readyState === 'open') sendBundle(channel);
      else channel.onopen = () => sendBundle(channel);
    };

    ctx.offIce = fb.onChildAdded(signalRef('/ice'), (snap) => {
      const v = snap.val();
      if (!v || v.from === myId) return;
      const candidate = fromPayload(v);
      if (!pc.remoteDescription) pendingIce.push(candidate);
      else pc.addIceCandidate(candidate).catch(() => {});
    });

    try {
      await pc.setRemoteDescription({ type: 'offer', sdp: offer.sdp });
      for (const c of pendingIce) await pc.addIceCandidate(c).catch(() => {});
      pendingIce.length = 0;
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      await fb.set(signalRef('/answer'), { from: myId, sdp: answer.sdp });
    } catch {
      // Negotiation failed: drop the half-built connection and its ICE
      // listener instead of leaving them dangling.
      if (active === ctx) closeActive();
    }
  }

  const offOffer = fb.onValue(signalRef('/offer'), (snap) => {
    const offer = snap.val();
    if (!offer || !offer.sdp || !offer.from || handled.has(offer.from)) return;
    handled.add(offer.from);
    handleOffer(offer).catch(() => {});
  });

  return function stop() {
    try { offOffer(); } catch {}
    closeActive();
  };
}
