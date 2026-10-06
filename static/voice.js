class VoiceClient {
  constructor(handlers) {
    this.h = handlers;
    this.pcs = new Map();
    this.remoteAudio = new Map();
    this.localStream = null;
    this.videoTrack = null;
    this.joined = false;
    this.muted = false;
    this.deafened = false;
    this.videoOn = false;
    this.peers = new Map();
    this.audioCtx = null;
    this.analysers = new Map();
    this.raf = null;
    this._makingOffer = new Map();
  }

  send(event) {
    this.h.sendEvent(event);
  }

  async join() {
    if (this.joined) return;
    try {
      this.localStream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        video: false,
      });
    } catch (err) {
      throw new Error("Microphone access failed: " + err.message);
    }
    this.joined = true;
    this.muted = false;
    this.deafened = false;
    this.videoOn = false;
    this.send({ type: "voice_join" });
    this.setupLocalAnalyser();
    this.h.onLocalState();
  }

  leave() {
    if (!this.joined) return;
    this.joined = false;
    this.send({ type: "voice_leave" });
    this.pcs.forEach((entry) => entry.pc.close());
    this.pcs.clear();
    this.remoteAudio.forEach((el) => el.remove());
    this.remoteAudio.clear();
    this.peers.clear();
    this.stopAnalysers();
    if (this.videoTrack) {
      this.videoTrack.stop();
      this.videoTrack = null;
    }
    if (this.localStream) {
      this.localStream.getTracks().forEach((t) => t.stop());
      this.localStream = null;
    }
    this.h.onPeersChanged();
    this.h.onLocalState();
  }

  async onPeers(peers) {
    for (const peer of peers) {
      this.peers.set(peer.user_id, peer);
      if (!this.pcs.has(peer.user_id)) {
        await this.createPeer(peer.user_id, true);
      }
    }
    this.h.onPeersChanged();
  }

  onPeerJoined(user) {
    this.peers.set(user.user_id, user);
    if (!this.pcs.has(user.user_id)) {
      this.createPeer(user.user_id, false);
    }
    this.h.onPeersChanged();
  }

  onPeerState(msg) {
    const peer = this.peers.get(msg.user_id) || { user_id: msg.user_id };
    peer.muted = msg.muted;
    peer.deafened = msg.deafened;
    peer.video = msg.video;
    this.peers.set(msg.user_id, peer);
    this.h.onPeersChanged();
  }

  onPeerLeft(uid) {
    this.peers.delete(uid);
    const entry = this.pcs.get(uid);
    if (entry) {
      entry.pc.close();
      this.pcs.delete(uid);
    }
    const audio = this.remoteAudio.get(uid);
    if (audio) {
      audio.remove();
      this.remoteAudio.delete(uid);
    }
    this.h.onPeersChanged();
  }

  async createPeer(uid, initiator) {
    const pc = new RTCPeerConnection({
      iceServers: [{ urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] }],
    });
    this.pcs.set(uid, { pc });
    for (const track of this.localStream.getTracks()) {
      pc.addTrack(track, this.localStream);
    }
    if (this.videoTrack) {
      pc.addTrack(this.videoTrack, this.localStream);
    }
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        this.send({ type: "voice_signal", target: uid, data: { type: "candidate", candidate: event.candidate } });
      }
    };
    pc.ontrack = (event) => {
      const stream = event.streams[0];
      if (event.track.kind === "audio") {
        let el = this.remoteAudio.get(uid);
        if (!el) {
          el = document.createElement("audio");
          el.autoplay = true;
          el.dataset.uid = uid;
          document.body.appendChild(el);
          this.remoteAudio.set(uid, el);
        }
        el.srcObject = stream;
        el.muted = this.deafened;
        this.setupRemoteAnalyser(uid, stream);
      } else if (event.track.kind === "video") {
        this.h.onRemoteVideo(uid, stream);
      }
    };
    pc.onnegotiationneeded = async () => {
      if (this._makingOffer.get(uid)) return;
      try {
        this._makingOffer.set(uid, true);
        await pc.setLocalDescription(await pc.createOffer());
        this.send({ type: "voice_signal", target: uid, data: { type: "offer", sdp: pc.localDescription } });
      } catch (e) {} finally {
        this._makingOffer.set(uid, false);
      }
    };
    if (initiator) {
      pc.onnegotiationneeded();
    }
    return pc;
  }

  async handleSignal(from, data) {
    let entry = this.pcs.get(from);
    if (!entry) {
      if (data.type !== "offer") return;
      const pc = await this.createPeer(from, false);
      entry = this.pcs.get(from);
      await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      this.send({ type: "voice_signal", target: from, data: { type: "answer", sdp: pc.localDescription } });
      return;
    }
    const pc = entry.pc;
    if (data.type === "offer") {
      await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      this.send({ type: "voice_signal", target: from, data: { type: "answer", sdp: pc.localDescription } });
    } else if (data.type === "answer") {
      await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
    } else if (data.type === "candidate") {
      try { await pc.addIceCandidate(new RTCIceCandidate(data.candidate)); } catch (e) {}
    }
  }

  toggleMute() {
    this.muted = !this.muted;
    if (this.localStream) {
      this.localStream.getAudioTracks().forEach((t) => (t.enabled = !this.muted));
    }
    this.send({ type: "voice_state", muted: this.muted, deafened: this.deafened, video: this.videoOn });
    this.h.onLocalState();
  }

  toggleDeafen() {
    this.deafened = !this.deafened;
    if (this.deafened && !this.muted) this.toggleMute();
    this.remoteAudio.forEach((el) => (el.muted = this.deafened));
    this.send({ type: "voice_state", muted: this.muted, deafened: this.deafened, video: this.videoOn });
    this.h.onLocalState();
  }

  async toggleVideo() {
    if (!this.joined) return;
    if (this.videoOn) {
      this.videoOn = false;
      if (this.videoTrack) {
        this.videoTrack.stop();
        this.pcs.forEach(({ pc }) => {
          const sender = pc.getSenders().find((s) => s.track === this.videoTrack);
          if (sender) pc.removeTrack(sender);
        });
        this.videoTrack = null;
      }
    } else {
      const cam = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 360 } });
      this.videoTrack = cam.getVideoTracks()[0];
      this.videoOn = true;
      const senderByPc = [];
      this.pcs.forEach(({ pc }, uid) => {
        pc.addTrack(this.videoTrack, this.localStream);
        senderByPc.push(pc);
      });
    }
    this.send({ type: "voice_state", muted: this.muted, deafened: this.deafened, video: this.videoOn });
    this.h.onLocalVideo();
    this.h.onLocalState();
  }

  setupLocalAnalyser() {
    if (!this.localStream) return;
    this.audioCtx = this.audioCtx || new AudioContext();
    const src = this.audioCtx.createMediaStreamSource(this.localStream);
    const analyser = this.audioCtx.createAnalyser();
    analyser.fftSize = 512;
    src.connect(analyser);
    this.analysers.set("self", analyser);
    this.startLoop();
  }

  setupRemoteAnalyser(uid, stream) {
    this.audioCtx = this.audioCtx || new AudioContext();
    try {
      const src = this.audioCtx.createMediaStreamSource(stream);
      const analyser = this.audioCtx.createAnalyser();
      analyser.fftSize = 512;
      src.connect(analyser);
      this.analysers.set(uid, analyser);
      this.startLoop();
    } catch (e) {}
  }

  startLoop() {
    if (this.raf) return;
    const buf = new Uint8Array(256);
    const tick = () => {
      this.analysers.forEach((analyser, key) => {
        analyser.getByteTimeDomainData(buf);
        let sum = 0;
        for (let i = 0; i < buf.length; i++) {
          const v = (buf[i] - 128) / 128;
          sum += v * v;
        }
        const rms = Math.sqrt(sum / buf.length);
        this.h.onSpeaking(key, rms > 0.045 && !(key === "self" && this.muted));
      });
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  stopAnalysers() {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = null;
    this.analysers.clear();
  }
}
