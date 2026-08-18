// Peer-to-peer book transfer over a WebRTC data channel.
//
// When someone joins a sync from the library for a book they don't have, the
// book's content is streamed directly device-to-device. Firebase is used only
// for signalling (SDP offer/answer + ICE candidates), written under the room's
// `signal` node; the book bytes themselves never touch Firebase.
//
// The joiner (receiver) initiates: it creates the offer and the data channel,
// and any holder sitting in the reader with the book open answers and streams
// the .vorlese bundle. Signalling is namespaced per joiner under
// `signal/<peerId>`, so several joiners can pull the book at once without
// colliding (see ADR 0009). Both peers are expected to be online at the same
// time and in the foreground (see ADR 0005); if no holder is online or a direct
// connection can't be made, receiveBook() rejects and the caller surfaces a
// "partner must be online" message.

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
  // Each joiner owns its own subtree, so two children pulling the book at the
  // same time can't clobber each other's offer/answer/ICE (see ADR 0009).
  const signalRef = (path) => fb.ref(fb.db, `rooms/${roomCode}/signal/${myId}${path}`);

  return new Promise((resolve, reject) => {
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    const channel = pc.createDataChannel('book');
    channel.binaryType = 'arraybuffer';

    const subscriptions = [];
    let settled = false;
    let remoteSet = false;
    let disconnectHandle = null;
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
      // Remove only our own subtree, so a sibling joiner's in-flight handshake
      // in the same room is left untouched — and only once that has actually
      // landed, cancel the standing onDisconnect. The other order would leave
      // the room holding a handshake with nothing registered to clean it up if
      // the removal is what failed. The handler is cancelled at all because the
      // socket lives on for the rest of the session, and a registration left on
      // this path would fire later, on an id long forgotten.
      const handle = disconnectHandle;
      disconnectHandle = null;
      fb.remove(signalRef(''))
        .then(() => handle?.cancel())
        .catch(() => {});
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

    // Have the server drop this subtree if we vanish. teardown() removes it on
    // every path this code controls, but a killed tab or a dead battery is not
    // one of those, and what would stay behind is the handshake: SDP and ICE
    // candidates, which carry the public IP address of both households (the
    // holder answers inside *our* subtree, so this one registration covers both
    // sides). Left lying in the room, that is readable for up to the room's
    // 30-day life by anyone holding the code — see ADR 26.
    //
    // Registered before the offer goes up, so there is no window in which our
    // candidates stand in the room unprotected. A registration that fails does
    // not stop the transfer: a book that never arrives ends the bedtime story,
    // while the lost guarantee only matters in the narrower case where this tab
    // is also killed before it can clean up after itself.
    disconnectHandle = fb.onDisconnect(signalRef(''));
    disconnectHandle.remove()
      .catch(() => { disconnectHandle = null; })
      // Clear any stale handshake, then publish our offer.
      .then(() => fb.remove(signalRef('')).catch(() => {}))
      .then(() => pc.createOffer())
      .then((offer) => pc.setLocalDescription(offer).then(() => offer))
      .then((offer) => fb.set(signalRef('/offer'), { from: myId, sdp: offer.sdp }))
      .catch((err) => fail(err));
  });
}

// Holder side. Listens for join requests and streams the book to each one.
// Returns a stop() function that tears down the listener and all peers.
//
// Each joiner gets its own `signal/<peerId>` subtree and its own
// RTCPeerConnection, so the holder can serve several joiners at once without
// their handshakes interfering (see ADR 0009). If more than one holder is
// present, every holder answers every joiner; the joiner accepts whichever
// answer arrives first, and the losing holder's connection simply never
// completes and is cleaned up on stop().
export function serveBook(fb, roomCode, getBundle) {
  const myId = `h${randomId()}`;
  const peers = new Map();
  const signalRef = (path) => fb.ref(fb.db, `rooms/${roomCode}/signal${path}`);

  function closePeer(peerId) {
    const ctx = peers.get(peerId);
    if (!ctx) return;
    try { ctx.offOffer?.(); } catch {}
    try { ctx.offIce?.(); } catch {}
    try { ctx.pc?.close(); } catch {}
    peers.delete(peerId);
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

  async function handleOffer(peerId, ctx, offer) {
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    ctx.pc = pc;
    const pendingIce = [];

    pc.onicecandidate = (e) => {
      if (!e.candidate) return;
      fb.push(signalRef(`/${peerId}/ice`), toPayload(e.candidate, myId)).catch(() => {});
    };

    // Reap each peer once its connection reaches a terminal state, so nothing
    // accumulates in the `peers` Map over a session: a finished transfer (the
    // receiver closes and we go to 'failed'), a losing race when several holders
    // answered the same joiner, or a joiner that gave up and retried under a new
    // id. Without this, dead connections and their ICE listeners pile up until
    // stop().
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
        closePeer(peerId);
      }
    };

    pc.ondatachannel = (e) => {
      const channel = e.channel;
      channel.binaryType = 'arraybuffer';
      channel.bufferedAmountLowThreshold = BUFFER_LOW;
      // The channel can already be open by the time this fires; don't miss it.
      if (channel.readyState === 'open') sendBundle(channel);
      else channel.onopen = () => sendBundle(channel);
    };

    ctx.offIce = fb.onChildAdded(signalRef(`/${peerId}/ice`), (snap) => {
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
      await fb.set(signalRef(`/${peerId}/answer`), { from: myId, sdp: answer.sdp });
    } catch {
      // Negotiation failed: drop this joiner's half-built connection and its
      // ICE listener instead of leaving them dangling.
      closePeer(peerId);
    }
  }

  // A new child under `signal/` is a new joiner. Watch its subtree for the
  // offer (ICE may land first, so we can't assume the child already has it).
  const offNew = fb.onChildAdded(signalRef(''), (snap) => {
    const peerId = snap.key;
    if (peers.has(peerId)) return;
    const ctx = { pc: null, offOffer: null, offIce: null };
    peers.set(peerId, ctx);
    // One answer per joiner: stop listening once we've taken the offer. A flag
    // rather than the unsubscribe handle, because if onValue ever delivers the
    // first value synchronously the handle isn't assigned yet inside the
    // callback; we then unsubscribe right after onValue returns.
    let taken = false;
    ctx.offOffer = fb.onValue(signalRef(`/${peerId}/offer`), (s) => {
      const offer = s.val();
      if (!offer || !offer.sdp || !offer.from || ctx.pc || taken) return;
      taken = true;
      if (ctx.offOffer) { try { ctx.offOffer(); } catch {} ctx.offOffer = null; }
      handleOffer(peerId, ctx, offer).catch(() => {});
    });
    if (taken && ctx.offOffer) { try { ctx.offOffer(); } catch {} ctx.offOffer = null; }
  });

  return function stop() {
    try { offNew(); } catch {}
    for (const peerId of [...peers.keys()]) closePeer(peerId);
  };
}
