import { SIM_TO_3D } from './arena';
import { multiplayerClient, MultiplayerSnapshot } from './multiplayerClient';
import { RoomState, VoiceSignalPayload } from './multiplayerTypes';
import { KeliEntity } from './types';

export const VOICE_REF_DISTANCE_SIM = 180;
export const VOICE_MAX_DISTANCE_SIM = 1150;

export type VoicePermissionState = 'idle' | 'prompting' | 'granted' | 'denied' | 'unsupported';
export type VoiceInputMode = 'open' | 'ptt';

export interface SpatialPeerTelemetry {
  id: string;
  name: string;
  distance: number;
  proximityRatio: number; // 0..1 smooth gain curve
  bearingRad: number; // angle from listener to speaker in world XZ
  speaking: boolean;
  voiceEnabled: boolean;
  mutedByPeer: boolean;
  localMuted: boolean;
  level: number; // 0..1 instantaneous voice energy
  inRange: boolean;
  alive: boolean;
}

export interface SpatialVoiceSnapshot {
  permission: VoicePermissionState;
  micEnabled: boolean;
  micMuted: boolean;
  voiceMode: VoiceInputMode;
  pttActive: boolean;
  localSpeaking: boolean;
  localMicLevel: number;
  voiceVolume: number;
  masterMuted: boolean;
  error: string | null;
  peers: SpatialPeerTelemetry[];
}

/**
 * Computes smooth proximity attenuation between full melee clarity (<= 180u)
 * and total acoustic drop-off (>= 1150u) across the Wang Kelian basin.
 */
export function computeProximityAttenuation(distance: number): number {
  if (!Number.isFinite(distance) || distance < 0) return 0;
  if (distance <= VOICE_REF_DISTANCE_SIM) return 1;
  if (distance >= VOICE_MAX_DISTANCE_SIM) return 0;
  const t = (distance - VOICE_REF_DISTANCE_SIM) / (VOICE_MAX_DISTANCE_SIM - VOICE_REF_DISTANCE_SIM);
  return Math.max(0, Math.min(1, Math.pow(1 - t, 1.55)));
}

interface PeerVoiceNode {
  peerId: string;
  name: string;
  pc: RTCPeerConnection;
  polite: boolean;
  makingOffer: boolean;
  ignoreOffer: boolean;
  isSettingRemoteAnswerPending: boolean;
  audioSender: RTCRtpSender | null;
  remoteStream: MediaStream | null;
  audioEl: HTMLAudioElement | null;
  sourceNode: MediaStreamAudioSourceNode | null;
  analyserNode: AnalyserNode | null;
  analyserData: Uint8Array<ArrayBuffer> | null;
  distanceGain: GainNode | null;
  pannerNode: PannerNode | null;
  stereoFallback: StereoPannerNode | null;
  remoteSpeakingFlag: boolean;
  remoteSpeakingTimeout: number | null;
  measuredLevel: number;
  distance: number;
  proximityRatio: number;
  bearingRad: number;
  inRange: boolean;
  alive: boolean;
  localMuted: boolean;
}

const RTC_CONFIG: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ],
};

class SpatialVoiceManager {
  private audioCtx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private localStream: MediaStream | null = null;
  private localTrack: MediaStreamTrack | null = null;
  private localSource: MediaStreamAudioSourceNode | null = null;
  private localAnalyser: AnalyserNode | null = null;
  private localAnalyserData: Uint8Array<ArrayBuffer> | null = null;

  private peers = new Map<string, PeerVoiceNode>();
  private mutedPeerIds = new Set<string>();
  private listeners = new Set<(snap: SpatialVoiceSnapshot) => void>();

  private currentRoom: RoomState | null = null;
  private localClientId: string | null = null;

  private permission: VoicePermissionState = 'idle';
  private micEnabled = false;
  private micMuted = false;
  private voiceMode: VoiceInputMode = 'open';
  private pttActive = false;
  private localSpeaking = false;
  private localMicLevel = 0;
  private voiceVolume = 0.9;
  private masterMuted = false;
  private error: string | null = null;

  private lastVoiceActivityAt = 0;
  private meterRafId: number | null = null;
  private initialized = false;
  private unsubscribes: Array<() => void> = [];

  public init() {
    if (this.initialized || typeof window === 'undefined') return;
    this.initialized = true;

    this.unsubscribes.push(
      multiplayerClient.subscribe((mpSnap) => this.handleMultiplayerSnapshot(mpSnap)),
      multiplayerClient.onVoiceSignal((msg) => void this.handleVoiceSignal(msg)),
      multiplayerClient.onVoiceSpeaking((msg) => this.handleRemoteSpeaking(msg)),
      multiplayerClient.onVoicePeerLeft((peerId) => this.removePeer(peerId))
    );
  }

  public dispose() {
    this.disableMic();
    this.teardownAllPeers();
    for (const unsub of this.unsubscribes) unsub();
    this.unsubscribes = [];
    this.initialized = false;
  }

  public subscribe(cb: (snap: SpatialVoiceSnapshot) => void): () => void {
    this.init();
    this.listeners.add(cb);
    cb(this.getSnapshot());
    return () => {
      this.listeners.delete(cb);
    };
  }

  public getSnapshot(): SpatialVoiceSnapshot {
    const roomParticipants = new Map(
      (this.currentRoom?.participants ?? []).map((p) => [p.id, p])
    );

    const peerTelemetry: SpatialPeerTelemetry[] = [];
    for (const node of this.peers.values()) {
      const part = roomParticipants.get(node.peerId);
      const mutedByPeer = Boolean(part?.voiceMuted);
      const voiceEnabled = Boolean(part?.voiceEnabled);
      const speaking =
        !mutedByPeer &&
        !node.localMuted &&
        (node.remoteSpeakingFlag || node.measuredLevel > 0.045);

      peerTelemetry.push({
        id: node.peerId,
        name: part?.name ?? node.name,
        distance: node.distance,
        proximityRatio: node.proximityRatio,
        bearingRad: node.bearingRad,
        speaking,
        voiceEnabled,
        mutedByPeer,
        localMuted: node.localMuted,
        level: node.measuredLevel,
        inRange: node.inRange,
        alive: node.alive,
      });
    }

    // Sort closest / active speakers first
    peerTelemetry.sort((a, b) => {
      if (a.speaking !== b.speaking) return a.speaking ? -1 : 1;
      if (a.inRange !== b.inRange) return a.inRange ? -1 : 1;
      return a.distance - b.distance;
    });

    return {
      permission: this.permission,
      micEnabled: this.micEnabled,
      micMuted: this.micMuted,
      voiceMode: this.voiceMode,
      pttActive: this.pttActive,
      localSpeaking: this.localSpeaking,
      localMicLevel: this.localMicLevel,
      voiceVolume: this.voiceVolume,
      masterMuted: this.masterMuted,
      error: this.error,
      peers: peerTelemetry,
    };
  }

  public getSpeakingPeerIds(): Set<string> {
    const ids = new Set<string>();
    if (this.localSpeaking && this.localClientId) {
      ids.add(this.localClientId);
    }
    for (const node of this.peers.values()) {
      if (
        !node.localMuted &&
        node.inRange &&
        (node.remoteSpeakingFlag || node.measuredLevel > 0.045)
      ) {
        ids.add(node.peerId);
      }
    }
    return ids;
  }

  private emit() {
    const snap = this.getSnapshot();
    this.listeners.forEach((cb) => cb(snap));
  }

  private ensureAudioContext(): AudioContext | null {
    if (typeof window === 'undefined') return null;
    if (!this.audioCtx) {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return null;
      this.audioCtx = new AudioCtx();
      this.masterGain = this.audioCtx.createGain();
      this.masterGain.gain.value = this.masterMuted ? 0 : this.voiceVolume;
      this.masterGain.connect(this.audioCtx.destination);
    }
    if (this.audioCtx.state === 'suspended') {
      this.audioCtx.resume().catch(() => {});
    }
    return this.audioCtx;
  }

  public unlockAudioContext() {
    this.ensureAudioContext();
  }

  public setMasterMuted(muted: boolean) {
    this.masterMuted = muted;
    if (this.masterGain && this.audioCtx) {
      this.masterGain.gain.setTargetAtTime(
        muted ? 0 : this.voiceVolume,
        this.audioCtx.currentTime,
        0.04
      );
    }
    this.emit();
  }

  public setVoiceVolume(vol: number) {
    this.voiceVolume = Math.max(0, Math.min(1, vol));
    if (this.masterGain && this.audioCtx && !this.masterMuted) {
      this.masterGain.gain.setTargetAtTime(this.voiceVolume, this.audioCtx.currentTime, 0.04);
    }
    this.emit();
  }

  public setVoiceMode(mode: VoiceInputMode) {
    this.voiceMode = mode;
    if (mode === 'open') {
      this.pttActive = false;
    }
    this.syncLocalTrackTransmission();
    this.emit();
  }

  public setPttActive(active: boolean) {
    if (this.voiceMode !== 'ptt') return;
    if (this.pttActive === active) return;
    this.pttActive = active;
    this.syncLocalTrackTransmission();
    this.emit();
  }

  public setMicMuted(muted: boolean) {
    this.micMuted = muted;
    this.syncLocalTrackTransmission();
    if (this.currentRoom) {
      multiplayerClient.sendVoiceState(this.micEnabled, this.micMuted);
    }
    this.emit();
  }

  public togglePeerLocalMute(peerId: string) {
    if (this.mutedPeerIds.has(peerId)) {
      this.mutedPeerIds.delete(peerId);
    } else {
      this.mutedPeerIds.add(peerId);
    }
    const node = this.peers.get(peerId);
    if (node) {
      node.localMuted = this.mutedPeerIds.has(peerId);
      if (node.localMuted && node.distanceGain && this.audioCtx) {
        node.distanceGain.gain.setTargetAtTime(0, this.audioCtx.currentTime, 0.03);
      }
    }
    this.emit();
  }

  public clearError() {
    this.error = null;
    this.emit();
  }

  public async enableMic(): Promise<boolean> {
    this.init();
    if (
      typeof navigator === 'undefined' ||
      !navigator.mediaDevices ||
      !navigator.mediaDevices.getUserMedia
    ) {
      this.permission = 'unsupported';
      this.error = 'Microphone capture is not supported in this browser.';
      this.emit();
      return false;
    }

    this.permission = 'prompting';
    this.error = null;
    this.emit();

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: false,
      });

      const tracks = stream.getAudioTracks();
      if (tracks.length === 0) {
        throw new Error('No microphone input track found.');
      }

      this.stopLocalStreamOnly();
      this.localStream = stream;
      this.localTrack = tracks[0];
      this.permission = 'granted';
      this.micEnabled = true;
      this.micMuted = false;
      this.syncLocalTrackTransmission();

      const ctx = this.ensureAudioContext();
      if (ctx) {
        this.localSource = ctx.createMediaStreamSource(stream);
        this.localAnalyser = ctx.createAnalyser();
        this.localAnalyser.fftSize = 256;
        this.localAnalyser.smoothingTimeConstant = 0.6;
        this.localSource.connect(this.localAnalyser);
        this.localAnalyserData = new Uint8Array(
          new ArrayBuffer(this.localAnalyser.frequencyBinCount)
        );
      }

      this.startMeterLoop();
      this.attachLocalTrackToPeers();

      if (this.currentRoom) {
        multiplayerClient.sendVoiceState(true, this.micMuted);
        this.syncPeersWithRoom();
      }
      this.emit();
      return true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const isDenied =
        /Permission|NotAllowed|denied/i.test(msg) ||
        (err instanceof DOMException && err.name === 'NotAllowedError');
      this.permission = isDenied ? 'denied' : 'unsupported';
      this.micEnabled = false;
      this.error = isDenied
        ? 'Microphone access was denied. Grant permission in browser settings to speak.'
        : `Could not access microphone: ${msg}`;
      this.emit();
      return false;
    }
  }

  public disableMic() {
    this.micEnabled = false;
    this.pttActive = false;
    this.localMicLevel = 0;
    if (this.localSpeaking) {
      this.localSpeaking = false;
      if (this.currentRoom) {
        multiplayerClient.sendVoiceSpeaking(false);
      }
    }
    this.detachLocalTrackFromPeers();
    this.stopLocalStreamOnly();

    if (this.currentRoom) {
      multiplayerClient.sendVoiceState(false, this.micMuted);
      this.syncPeersWithRoom();
    }
    this.emit();
  }

  private stopLocalStreamOnly() {
    if (this.localSource) {
      try {
        this.localSource.disconnect();
      } catch {
        // Ignore disconnect errors
      }
      this.localSource = null;
    }
    this.localAnalyser = null;
    this.localAnalyserData = null;

    if (this.localStream) {
      for (const track of this.localStream.getTracks()) {
        try {
          track.stop();
        } catch {
          // Ignore stop errors
        }
      }
      this.localStream = null;
    }
    this.localTrack = null;
  }

  private isActivelyTransmitting(): boolean {
    if (!this.micEnabled || this.micMuted) return false;
    if (this.voiceMode === 'ptt') return this.pttActive;
    return true;
  }

  private syncLocalTrackTransmission() {
    if (this.localTrack) {
      this.localTrack.enabled = this.isActivelyTransmitting();
    }
  }

  private handleMultiplayerSnapshot(mpSnap: MultiplayerSnapshot) {
    const prevRoomCode = this.currentRoom?.code ?? null;
    const nextRoom = mpSnap.currentRoom;
    this.localClientId = mpSnap.clientId;
    this.currentRoom = nextRoom;

    if (!nextRoom || (prevRoomCode && nextRoom.code !== prevRoomCode)) {
      this.teardownAllPeers();
      if (!nextRoom) {
        this.emit();
        return;
      }
    }

    if (this.micEnabled && nextRoom && prevRoomCode !== nextRoom.code) {
      multiplayerClient.sendVoiceState(true, this.micMuted);
    }

    this.syncPeersWithRoom();
    this.emit();
  }

  private syncPeersWithRoom() {
    if (!this.currentRoom || !this.localClientId) return;
    if (typeof RTCPeerConnection === 'undefined') return;

    const neededPeerIds = new Set<string>();
    for (const part of this.currentRoom.participants) {
      if (part.id === this.localClientId || !part.connected) continue;
      // Connect if either local mic OR remote mic is enabled (allows listen-only users to hear speakers!)
      if (this.micEnabled || part.voiceEnabled) {
        neededPeerIds.add(part.id);
        this.ensurePeerNode(part.id, part.name);
      }
    }

    for (const peerId of Array.from(this.peers.keys())) {
      if (!neededPeerIds.has(peerId)) {
        this.removePeer(peerId);
      }
    }

    if (neededPeerIds.size > 0) {
      this.startMeterLoop();
    }
  }

  private ensurePeerNode(peerId: string, name: string): PeerVoiceNode {
    const existing = this.peers.get(peerId);
    if (existing) {
      existing.name = name;
      return existing;
    }

    const pc = new RTCPeerConnection(RTC_CONFIG);
    const localId = this.localClientId ?? '';
    const polite = localId > peerId; // Smaller ID is impolite initiator

    const node: PeerVoiceNode = {
      peerId,
      name,
      pc,
      polite,
      makingOffer: false,
      ignoreOffer: false,
      isSettingRemoteAnswerPending: false,
      audioSender: null,
      remoteStream: null,
      audioEl: null,
      sourceNode: null,
      analyserNode: null,
      analyserData: null,
      distanceGain: null,
      pannerNode: null,
      stereoFallback: null,
      remoteSpeakingFlag: false,
      remoteSpeakingTimeout: null,
      measuredLevel: 0,
      distance: 0,
      proximityRatio: 1,
      bearingRad: 0,
      inRange: true,
      alive: true,
      localMuted: this.mutedPeerIds.has(peerId),
    };

    if (this.localTrack && this.localStream) {
      node.audioSender = pc.addTrack(this.localTrack, this.localStream);
    } else if (!polite) {
      // Listen-only initiator adds recvonly transceiver so SDP offer negotiates incoming audio
      const trans = pc.addTransceiver('audio', { direction: 'recvonly' });
      node.audioSender = trans.sender;
    }

    pc.onicecandidate = ({ candidate }) => {
      if (candidate) {
        multiplayerClient.sendVoiceSignal(peerId, {
          candidate: {
            candidate: candidate.candidate,
            sdpMid: candidate.sdpMid,
            sdpMLineIndex: candidate.sdpMLineIndex,
            usernameFragment: candidate.usernameFragment,
          },
        });
      }
    };

    pc.onnegotiationneeded = async () => {
      try {
        node.makingOffer = true;
        await pc.setLocalDescription();
        if (pc.localDescription) {
          multiplayerClient.sendVoiceSignal(peerId, {
            sdp: {
              type: pc.localDescription.type,
              sdp: pc.localDescription.sdp,
            },
          });
        }
      } catch {
        // Ignore transient negotiation race errors handled by Perfect Negotiation
      } finally {
        node.makingOffer = false;
      }
    };

    pc.ontrack = ({ track, streams }) => {
      if (track.kind !== 'audio') return;
      const stream = streams[0] ?? new MediaStream([track]);
      this.attachRemoteStreamSpatialGraph(node, stream);
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed') {
        pc.restartIce?.();
      }
    };

    this.peers.set(peerId, node);
    return node;
  }

  private attachLocalTrackToPeers() {
    if (!this.localTrack || !this.localStream) return;
    for (const node of this.peers.values()) {
      if (node.audioSender) {
        void node.audioSender.replaceTrack(this.localTrack);
        const trans = node.pc.getTransceivers().find((t) => t.sender === node.audioSender);
        if (trans && trans.direction === 'recvonly') {
          trans.direction = 'sendrecv';
        }
      } else {
        node.audioSender = node.pc.addTrack(this.localTrack, this.localStream);
      }
    }
  }

  private detachLocalTrackFromPeers() {
    for (const node of this.peers.values()) {
      if (node.audioSender) {
        void node.audioSender.replaceTrack(null);
      }
    }
  }

  private attachRemoteStreamSpatialGraph(node: PeerVoiceNode, stream: MediaStream) {
    this.cleanupPeerAudioGraph(node);
    node.remoteStream = stream;

    // Hidden muted <audio> keeps Chrome/Edge WebRTC RTP decoder active for MediaStreamAudioSourceNode
    if (typeof document !== 'undefined') {
      const audioEl = document.createElement('audio');
      audioEl.autoplay = true;
      audioEl.setAttribute('playsinline', 'true');
      audioEl.muted = true;
      audioEl.srcObject = stream;
      audioEl.play().catch(() => {});
      node.audioEl = audioEl;
    }

    const ctx = this.ensureAudioContext();
    if (!ctx || !this.masterGain) return;

    try {
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.55;

      const distanceGain = ctx.createGain();
      distanceGain.gain.value = node.localMuted ? 0 : node.proximityRatio;

      source.connect(analyser);
      analyser.connect(distanceGain);

      if (typeof ctx.createPanner === 'function') {
        const panner = ctx.createPanner();
        panner.panningModel = 'HRTF';
        panner.distanceModel = 'linear';
        panner.refDistance = 1;
        panner.maxDistance = 10000;
        panner.rolloffFactor = 0; // Attenuation explicitly governed by distanceGain
        distanceGain.connect(panner);
        panner.connect(this.masterGain);
        node.pannerNode = panner;
      } else {
        const stereo = ctx.createStereoPanner();
        distanceGain.connect(stereo);
        stereo.connect(this.masterGain);
        node.stereoFallback = stereo;
      }

      node.sourceNode = source;
      node.analyserNode = analyser;
      node.analyserData = new Uint8Array(new ArrayBuffer(analyser.frequencyBinCount));
      node.distanceGain = distanceGain;
    } catch {
      // Fallback: unmute audioEl cleanly if Web Audio graph creation fails
      if (node.audioEl) {
        node.audioEl.muted = false;
      }
    }
  }

  private async handleVoiceSignal(msg: {
    fromId: string;
    fromName: string;
    signal: VoiceSignalPayload;
  }) {
    if (typeof RTCPeerConnection === 'undefined') return;
    if (!this.currentRoom || msg.fromId === this.localClientId) return;

    const node = this.ensurePeerNode(msg.fromId, msg.fromName);
    const { pc } = node;
    const { sdp, candidate } = msg.signal;

    try {
      if (sdp) {
        const readyForOffer =
          !node.makingOffer && (pc.signalingState === 'stable' || node.isSettingRemoteAnswerPending);
        const offerCollision = sdp.type === 'offer' && !readyForOffer;
        node.ignoreOffer = !node.polite && offerCollision;
        if (node.ignoreOffer) return;

        node.isSettingRemoteAnswerPending = sdp.type === 'answer';
        await pc.setRemoteDescription(new RTCSessionDescription(sdp));
        node.isSettingRemoteAnswerPending = false;

        if (sdp.type === 'offer') {
          if (this.localTrack && this.localStream && !node.audioSender) {
            node.audioSender = pc.addTrack(this.localTrack, this.localStream);
          }
          await pc.setLocalDescription();
          if (pc.localDescription) {
            multiplayerClient.sendVoiceSignal(node.peerId, {
              sdp: {
                type: pc.localDescription.type,
                sdp: pc.localDescription.sdp,
              },
            });
          }
        }
      } else if (candidate) {
        try {
          await pc.addIceCandidate(new RTCIceCandidate(candidate));
        } catch (err) {
          if (!node.ignoreOffer) throw err;
        }
      }
    } catch {
      // Ignore stale SDP/ICE race packets after reconnect
    }
  }

  private handleRemoteSpeaking(msg: { peerId: string; speaking: boolean }) {
    const node = this.peers.get(msg.peerId);
    if (!node) return;
    node.remoteSpeakingFlag = msg.speaking;
    if (node.remoteSpeakingTimeout !== null) {
      window.clearTimeout(node.remoteSpeakingTimeout);
      node.remoteSpeakingTimeout = null;
    }
    if (msg.speaking) {
      node.remoteSpeakingTimeout = window.setTimeout(() => {
        node.remoteSpeakingFlag = false;
        this.emit();
      }, 1500);
    }
    this.emit();
  }

  private cleanupPeerAudioGraph(node: PeerVoiceNode) {
    if (node.audioEl) {
      try {
        node.audioEl.pause();
        node.audioEl.srcObject = null;
      } catch {
        // Ignore cleanup errors
      }
      node.audioEl = null;
    }
    try {
      node.sourceNode?.disconnect();
      node.analyserNode?.disconnect();
      node.distanceGain?.disconnect();
      node.pannerNode?.disconnect();
      node.stereoFallback?.disconnect();
    } catch {
      // Ignore disconnect errors
    }
    node.sourceNode = null;
    node.analyserNode = null;
    node.analyserData = null;
    node.distanceGain = null;
    node.pannerNode = null;
    node.stereoFallback = null;
  }

  private removePeer(peerId: string) {
    const node = this.peers.get(peerId);
    if (!node) return;
    if (node.remoteSpeakingTimeout !== null) {
      window.clearTimeout(node.remoteSpeakingTimeout);
    }
    this.cleanupPeerAudioGraph(node);
    try {
      node.pc.close();
    } catch {
      // Ignore close errors
    }
    this.peers.delete(peerId);
    this.emit();
  }

  private teardownAllPeers() {
    for (const peerId of Array.from(this.peers.keys())) {
      this.removePeer(peerId);
    }
    this.stopMeterLoopIfIdle();
  }

  /**
   * Updates 3D Web Audio AudioListener, each remote speaker's HRTF PannerNode position,
   * and smooth distance rolloff relative to the local listener/spectated Keli.
   */
  public updateSpatialPositions(
    listenerX: number,
    listenerZ: number,
    kelis: KeliEntity[],
    inActiveMatch: boolean
  ) {
    const ctx = this.audioCtx;
    const now = ctx?.currentTime ?? 0;

    if (ctx) {
      const lx = listenerX * SIM_TO_3D;
      const lz = listenerZ * SIM_TO_3D;
      const listener = ctx.listener;
      if (listener.positionX) {
        listener.positionX.setTargetAtTime(lx, now, 0.03);
        listener.positionY.setTargetAtTime(0, now, 0.03);
        listener.positionZ.setTargetAtTime(lz, now, 0.03);
        // Camera looks screen-North (-Z) with +X to the right
        listener.forwardX.setValueAtTime(0, now);
        listener.forwardY.setValueAtTime(0, now);
        listener.forwardZ.setValueAtTime(-1, now);
        listener.upX.setValueAtTime(0, now);
        listener.upY.setValueAtTime(1, now);
        listener.upZ.setValueAtTime(0, now);
      } else if (typeof listener.setPosition === 'function') {
        listener.setPosition(lx, 0, lz);
        listener.setOrientation(0, 0, -1, 0, 1, 0);
      }
    }

    const entityById = new Map(kelis.map((k) => [k.id, k]));

    for (const node of this.peers.values()) {
      const remote = entityById.get(node.peerId);
      if (!inActiveMatch) {
        node.distance = 0;
        node.proximityRatio = 1;
        node.bearingRad = 0;
        node.inRange = true;
        node.alive = true;
        if (ctx && node.pannerNode) {
          node.pannerNode.positionX.setTargetAtTime(listenerX * SIM_TO_3D, now, 0.04);
          node.pannerNode.positionY.setTargetAtTime(0, now, 0.04);
          node.pannerNode.positionZ.setTargetAtTime(listenerZ * SIM_TO_3D, now, 0.04);
        }
        if (ctx && node.distanceGain) {
          node.distanceGain.gain.setTargetAtTime(node.localMuted ? 0 : 1, now, 0.04);
        }
        continue;
      }

      if (!remote || !remote.alive) {
        node.alive = Boolean(remote?.alive);
        node.distance = VOICE_MAX_DISTANCE_SIM;
        node.proximityRatio = 0;
        node.inRange = false;
        if (ctx && node.distanceGain) {
          node.distanceGain.gain.setTargetAtTime(0, now, 0.05);
        }
        continue;
      }

      node.alive = true;
      const dx = remote.x - listenerX;
      const dz = remote.z - listenerZ;
      const dist = Math.hypot(dx, dz);
      const gain = computeProximityAttenuation(dist);

      node.distance = Math.round(dist);
      node.proximityRatio = gain;
      node.bearingRad = Math.atan2(dz, dx);
      node.inRange = gain > 0.005;

      if (ctx) {
        if (node.pannerNode) {
          node.pannerNode.positionX.setTargetAtTime(remote.x * SIM_TO_3D, now, 0.04);
          node.pannerNode.positionY.setTargetAtTime(0, now, 0.04);
          node.pannerNode.positionZ.setTargetAtTime(remote.z * SIM_TO_3D, now, 0.04);
        } else if (node.stereoFallback) {
          const pan = Math.max(-1, Math.min(1, dx / 480));
          node.stereoFallback.pan.setTargetAtTime(pan, now, 0.04);
        }
        if (node.distanceGain) {
          node.distanceGain.gain.setTargetAtTime(node.localMuted ? 0 : gain, now, 0.04);
        }
      }
    }
  }

  private measureAnalyserRms(analyser: AnalyserNode, buf: Uint8Array<ArrayBuffer>): number {
    analyser.getByteTimeDomainData(buf);
    let sumSq = 0;
    for (let i = 0; i < buf.length; i++) {
      const sample = (buf[i] - 128) / 128;
      sumSq += sample * sample;
    }
    const rms = Math.sqrt(sumSq / buf.length);
    return Math.min(1, rms * 3.8);
  }

  private startMeterLoop() {
    if (this.meterRafId !== null || typeof window === 'undefined') return;
    let lastEmit = 0;

    const tick = (now: number) => {
      if (!this.micEnabled && this.peers.size === 0) {
        this.meterRafId = null;
        return;
      }

      let changed = false;

      if (this.micEnabled && this.localAnalyser && this.localAnalyserData && this.isActivelyTransmitting()) {
        const level = this.measureAnalyserRms(this.localAnalyser, this.localAnalyserData);
        this.localMicLevel = level;
        const above = level > 0.06;
        if (above) this.lastVoiceActivityAt = now;
        const nextSpeaking = above || now - this.lastVoiceActivityAt < 280;
        if (nextSpeaking !== this.localSpeaking) {
          this.localSpeaking = nextSpeaking;
          multiplayerClient.sendVoiceSpeaking(nextSpeaking);
          changed = true;
        }
      } else {
        if (this.localMicLevel !== 0) {
          this.localMicLevel = 0;
          changed = true;
        }
        if (this.localSpeaking) {
          this.localSpeaking = false;
          multiplayerClient.sendVoiceSpeaking(false);
          changed = true;
        }
      }

      for (const node of this.peers.values()) {
        if (node.analyserNode && node.analyserData) {
          node.measuredLevel = this.measureAnalyserRms(node.analyserNode, node.analyserData);
        }
      }

      if (changed || now - lastEmit >= 110) {
        lastEmit = now;
        this.emit();
      }

      this.meterRafId = window.requestAnimationFrame(tick);
    };

    this.meterRafId = window.requestAnimationFrame(tick);
  }

  private stopMeterLoopIfIdle() {
    if (!this.micEnabled && this.peers.size === 0 && this.meterRafId !== null) {
      window.cancelAnimationFrame(this.meterRafId);
      this.meterRafId = null;
    }
  }
}

export const spatialVoice = new SpatialVoiceManager();
