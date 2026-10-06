(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('../core/math.js'));
  } else {
    root.NightSky = root.NightSky || {};
    root.NightSky.Audio = factory(root.NightSky.Math);
  }
})(typeof globalThis !== 'undefined' ? globalThis : window, function (MathUtils) {
  'use strict';

  const clamp = MathUtils ? MathUtils.clamp : (v, min, max) => (v < min ? min : v > max ? max : v);

  const CHORD_PRESETS = [
    { root: 73.42, notes: [146.83, 220.0, 369.99, 440.0, 659.26] },
    { root: 58.27, notes: [116.54, 174.61, 293.66, 440.0, 523.25] },
    { root: 87.31, notes: [174.61, 261.63, 440.0, 659.26, 783.99] },
    { root: 65.41, notes: [130.81, 196.0, 329.63, 587.33, 783.99] },
    { root: 98.0, notes: [146.83, 233.08, 369.99, 440.0, 587.33] },
    { root: 55.0, notes: [110.0, 164.81, 220.0, 293.66, 659.26] },
  ];

  const CHORD_MEASURE = 27;
  const CHORD_ATTACK = 9;
  const CHORD_RELEASE = 12;

  class SoundEngine {
    constructor() {
      this.ctx = null;
      this.masterGain = null;
      this.mainGain = null;
      this.bedGain = null;
      this.noiseBuffer = null;
      this.reverbConvolver = null;
      this.dynamicParams = null;

      this.isBuilt = false;
      this.isEnabled = false;
      this.notesCount = 0;
      this.chordIndex = 0;

      this.lastTriggerTimes = {};
      this.telemetryMetrics = {};
    }

    init() {
      if (this.ctx) return this.ctx;
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) return null;

      this.ctx = new AudioContextClass();
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = 0;
      this.masterGain.connect(this.ctx.destination);
      return this.ctx;
    }

    createReverbBuffer(durationSeconds, decayRate) {
      const sampleRate = this.ctx.sampleRate;
      const length = Math.floor(sampleRate * durationSeconds);
      const buffer = this.ctx.createBuffer(2, length, sampleRate);
      for (let channel = 0; channel < 2; channel++) {
        const data = buffer.getChannelData(channel);
        for (let i = 0; i < length; i++) {
          data[i] = (2 * Math.random() - 1) * Math.pow(1 - i / length, decayRate);
        }
      }
      return buffer;
    }

    createNoiseBuffer(durationSeconds) {
      const sampleRate = this.ctx.sampleRate;
      const length = Math.floor(sampleRate * durationSeconds);
      const buffer = this.ctx.createBuffer(1, length, sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < length; i++) {
        data[i] = 2 * Math.random() - 1;
      }
      return buffer;
    }

    build() {
      if (this.isBuilt || !this.ctx) return;
      this.isBuilt = true;

      const ctx = this.ctx;

      this.reverbConvolver = ctx.createConvolver();
      this.reverbConvolver.buffer = this.createReverbBuffer(3.4, 2.6);

      const reverbWetGain = ctx.createGain();
      reverbWetGain.gain.value = 0.38;
      this.reverbConvolver.connect(reverbWetGain);
      reverbWetGain.connect(this.masterGain);

      this.mainGain = ctx.createGain();
      this.mainGain.connect(this.masterGain);
      this.mainGain.connect(this.reverbConvolver);

      this.bedGain = ctx.createGain();
      this.bedGain.connect(this.masterGain);

      this.noiseBuffer = this.createNoiseBuffer(3);

      this._setupDroneBed();
      this._setupBreezeNoise();

      this._startModulationLoop();
    }

    _setupDroneBed() {
      const ctx = this.ctx;
      this.bedGain.gain.value = 0.8;

      const longReverb = ctx.createConvolver();
      longReverb.buffer = this.createReverbBuffer(7.5, 1.9);
      const longWet = ctx.createGain();
      longWet.gain.value = 0.55;
      this.bedGain.connect(longReverb);
      longReverb.connect(longWet);
      longWet.connect(this.masterGain);

      const startSchedule = this._scheduleChords(
        this.bedGain,
        ctx.currentTime + 0.4,
        2 * CHORD_MEASURE,
      );
      let nextTime = startSchedule.t;
      let chordIdx = startSchedule.i;

      setInterval(() => {
        const now = ctx.currentTime;
        this.chordIndex = Math.max(
          0,
          Math.floor((now - (startSchedule.t - 2 * CHORD_MEASURE)) / CHORD_MEASURE),
        );
        while (nextTime < now + CHORD_MEASURE + CHORD_RELEASE) {
          this._playChord(this.bedGain, chordIdx, nextTime);
          nextTime += CHORD_MEASURE;
          chordIdx++;
        }
      }, 1000);
    }

    _setupBreezeNoise() {
      const ctx = this.ctx;

      const noiseSource = ctx.createBufferSource();
      noiseSource.buffer = this.noiseBuffer;
      noiseSource.loop = true;

      const bandpass = ctx.createBiquadFilter();
      bandpass.type = 'bandpass';
      bandpass.frequency.value = 600;
      bandpass.Q.value = 1.1;

      const breezeGain = ctx.createGain();
      breezeGain.gain.value = 0;

      noiseSource.connect(bandpass);
      bandpass.connect(breezeGain);
      breezeGain.connect(this.mainGain);
      noiseSource.start();

      const shimmerGain = ctx.createGain();
      shimmerGain.gain.value = 0;
      shimmerGain.connect(this.mainGain);

      [2093, 2637, 3136].forEach((freq, idx) => {
        const osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.value = freq * (1 + 0.004 * (idx - 1));

        const oscGain = ctx.createGain();
        oscGain.gain.value = 0.5;

        const lfo = ctx.createOscillator();
        lfo.frequency.value = 5.5 + 1.7 * idx;

        const lfoGain = ctx.createGain();
        lfoGain.gain.value = 0.5;

        lfo.connect(lfoGain);
        lfoGain.connect(oscGain.gain);
        lfo.start();

        osc.connect(oscGain);
        oscGain.connect(shimmerGain);
        osc.start();
      });

      this.dynamicParams = {
        g: breezeGain,
        bp: bandpass,
        shg: shimmerGain,
        v: 0,
      };
    }

    _lfoModulate(param, baseVal, depth, freq, startTime) {
      param.setValueAtTime(baseVal, startTime);
      const lfo = this.ctx.createOscillator();
      lfo.frequency.value = freq;
      const lfoGain = this.ctx.createGain();
      lfoGain.gain.value = depth;
      lfo.connect(lfoGain);
      lfoGain.connect(param);
      lfo.start(startTime);
      return lfo;
    }

    _playChime(destGain, freq, startTime, volume, pan) {
      const ctx = this.ctx;
      [
        [1, 1, 6.5],
        [2.76, 0.1, 2.2],
        [5.4, 0.03, 1.1],
      ].forEach(([harm, amp, decay]) => {
        const osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.value = freq * harm * (1 + 0.001 * (Math.random() - 0.5));

        const gain = ctx.createGain();
        gain.gain.setValueAtTime(0, startTime);
        gain.gain.linearRampToValueAtTime(volume * amp, startTime + 0.9);
        gain.gain.exponentialRampToValueAtTime(1e-4, startTime + 0.9 + decay);

        const panner = ctx.createStereoPanner();
        panner.pan.value = pan;

        osc.connect(gain);
        gain.connect(panner);
        panner.connect(destGain);

        osc.start(startTime);
        osc.stop(startTime + decay + 1);
      });
      this.notesCount++;
    }

    _playChord(destGain, chordIndex, startTime) {
      const ctx = this.ctx;
      const preset = CHORD_PRESETS[chordIndex % CHORD_PRESETS.length];

      preset.notes.forEach((freq, noteIdx) => {
        const filter = ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.Q.value = 0.7;

        this._lfoModulate(filter.frequency, 560, 190, 1 / 61, startTime);

        const noteGain = ctx.createGain();
        const targetVol = [0.028, 0.024, 0.02, 0.013, 0.009][noteIdx];
        noteGain.gain.setValueAtTime(0, startTime);
        noteGain.gain.linearRampToValueAtTime(targetVol, startTime + CHORD_ATTACK);
        noteGain.gain.setValueAtTime(targetVol, startTime + CHORD_MEASURE);
        noteGain.gain.linearRampToValueAtTime(0, startTime + CHORD_MEASURE + CHORD_RELEASE);

        const panner = ctx.createStereoPanner();
        this._lfoModulate(
          panner.pan,
          0.3 * (noteIdx - 2),
          0.35,
          1 / (47 + 30 * Math.random()),
          startTime,
        );

        const stopTime = startTime + CHORD_MEASURE + CHORD_RELEASE + 0.1;
        [
          ['sawtooth', 1, 0.32],
          ['triangle', 1.0028, 0.9],
          ['sine', 0.9965, 0.6],
        ].forEach(([wave, ratio, amp]) => {
          const osc = ctx.createOscillator();
          osc.type = wave;
          osc.frequency.value = freq * ratio;

          const oscGain = ctx.createGain();
          oscGain.gain.value = amp;

          osc.connect(oscGain);
          oscGain.connect(filter);
          osc.start(startTime);
          osc.stop(stopTime);
        });

        filter.connect(noteGain);
        noteGain.connect(panner);
        panner.connect(destGain);
      });

      const rootOsc = ctx.createOscillator();
      rootOsc.type = 'sine';
      rootOsc.frequency.value = preset.root;

      const rootSub = ctx.createOscillator();
      rootSub.type = 'sine';
      rootSub.frequency.value = 2.001 * preset.root;

      const subGain = ctx.createGain();
      subGain.gain.value = 0.22;

      const rootGain = ctx.createGain();
      rootGain.gain.setValueAtTime(0, startTime);
      rootGain.gain.linearRampToValueAtTime(0.075, startTime + 0.8 * CHORD_ATTACK);
      rootGain.gain.setValueAtTime(0.075, startTime + CHORD_MEASURE);
      rootGain.gain.linearRampToValueAtTime(0, startTime + CHORD_MEASURE + 0.7 * CHORD_RELEASE);

      const rootTremolo = ctx.createGain();
      this._lfoModulate(rootTremolo.gain, 0.8, 0.2, 1 / 17, startTime);

      rootOsc.connect(rootGain);
      rootSub.connect(subGain);
      subGain.connect(rootGain);
      rootGain.connect(rootTremolo);
      rootTremolo.connect(destGain);

      const rootStop = startTime + CHORD_MEASURE + CHORD_RELEASE;
      rootOsc.start(startTime);
      rootSub.start(startTime);
      rootOsc.stop(rootStop);
      rootSub.stop(rootStop);

      const chimeCount = 2 + (Math.random() < 0.5 ? 1 : 0);
      let chimeTime = startTime + 0.6 * CHORD_ATTACK + 4 * Math.random();
      for (let i = 0; i < chimeCount && chimeTime < startTime + CHORD_MEASURE; i++) {
        const note =
          preset.notes[2 + Math.floor(3 * Math.random())] * (Math.random() < 0.35 ? 1 : 2);
        this._playChime(
          destGain,
          note,
          chimeTime,
          0.026 * (0.8 + 0.4 * Math.random()),
          1.2 * (Math.random() - 0.5),
        );
        chimeTime += 6.5 + 6 * Math.random();
      }
    }

    _scheduleChords(destGain, startTime, totalDuration) {
      const ctx = this.ctx;

      const noiseSrc = ctx.createBufferSource();
      noiseSrc.buffer = this.noiseBuffer;
      noiseSrc.loop = true;

      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.Q.value = 1.3;
      this._lfoModulate(bp.frequency, 900, 520, 1 / 43, startTime);

      const bpGain = ctx.createGain();
      bpGain.gain.setValueAtTime(0, startTime);
      bpGain.gain.linearRampToValueAtTime(0.011, startTime + CHORD_ATTACK);
      this._lfoModulate(bpGain.gain, 0.011, 0.004, 1 / 23, startTime + CHORD_ATTACK);

      const panner = ctx.createStereoPanner();
      this._lfoModulate(panner.pan, 0, 0.7, 1 / 37, startTime);

      noiseSrc.connect(bp);
      bp.connect(bpGain);
      bpGain.connect(panner);
      panner.connect(destGain);
      noiseSrc.start(startTime);

      const hpNoise = ctx.createBufferSource();
      hpNoise.buffer = this.noiseBuffer;
      hpNoise.loop = true;

      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 5200;

      const hpGain = ctx.createGain();
      hpGain.gain.setValueAtTime(0, startTime);
      hpGain.gain.linearRampToValueAtTime(0.0022, startTime + CHORD_ATTACK);

      hpNoise.connect(hp);
      hp.connect(hpGain);
      hpGain.connect(destGain);
      hpNoise.start(startTime);

      let t = startTime;
      let idx = 0;
      while (t < startTime + totalDuration) {
        this._playChord(destGain, idx, t);
        t += CHORD_MEASURE;
        idx++;
      }
      return { t: t, i: idx };
    }

    _canTrigger(name, cooldownMs) {
      if (!this.isEnabled || !this.ctx) return false;
      this.build();
      const now = performance.now();
      if (this.lastTriggerTimes[name] && now - this.lastTriggerTimes[name] < cooldownMs) {
        return false;
      }
      this.lastTriggerTimes[name] = now;
      return true;
    }

    _playSynthTone(freq, startTime, gainVal, duration, type, pitchRamp) {
      const ctx = this.ctx;
      const osc = ctx.createOscillator();
      osc.type = type || 'sine';
      osc.frequency.setValueAtTime(freq, startTime);
      if (pitchRamp) {
        osc.frequency.exponentialRampToValueAtTime(freq * pitchRamp, startTime + 0.6 * duration);
      }
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0, startTime);
      gain.gain.linearRampToValueAtTime(gainVal, startTime + 0.012);
      gain.gain.exponentialRampToValueAtTime(1e-4, startTime + duration);

      osc.connect(gain);
      gain.connect(this.mainGain);
      osc.start(startTime);
      osc.stop(startTime + duration + 0.05);
    }

    _startModulationLoop() {
      const updateLoop = () => {
        if (typeof requestAnimationFrame === 'function') {
          requestAnimationFrame(updateLoop);
        }
        if (!this.dynamicParams || !this.ctx) return;

        const now = performance.now();
        let maxMetric = 0;
        for (const key in this.telemetryMetrics) {
          if (now - this.telemetryMetrics[key].t > 160) {
            this.telemetryMetrics[key].v = 0;
          }
          maxMetric = Math.max(maxMetric, this.telemetryMetrics[key].v);
        }
        maxMetric = clamp(maxMetric, 0, 1);
        this.dynamicParams.v = maxMetric;

        const curTime = this.ctx.currentTime;
        const active = this.isEnabled ? 1 : 0;
        this.dynamicParams.g.gain.setTargetAtTime(
          active * maxMetric * (0.05 + 0.08 * maxMetric),
          curTime,
          0.09,
        );
        this.dynamicParams.bp.frequency.setTargetAtTime(500 + 1500 * maxMetric, curTime, 0.12);
        this.dynamicParams.shg.gain.setTargetAtTime(
          0.022 * active * maxMetric * maxMetric,
          curTime,
          0.12,
        );
      };
      updateLoop();
    }

    toggle(enabled) {
      this.isEnabled = !!enabled;
      if (this.isEnabled) {
        this.init();
        this.build();
        if (this.ctx) {
          if (this.ctx.state === 'suspended') {
            this.ctx.resume();
          }
          this.masterGain.gain.cancelScheduledValues(this.ctx.currentTime);
          this.masterGain.gain.setTargetAtTime(0.3, this.ctx.currentTime, 1.6);
        }
      } else if (this.ctx) {
        this.masterGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.5);
      }
    }

    shimmer() {
      if (!this._canTrigger('shimmer', 220)) return;
      const now = this.ctx.currentTime;

      const noise = this.ctx.createBufferSource();
      noise.buffer = this.noiseBuffer;
      const filter = this.ctx.createBiquadFilter();
      filter.type = 'highpass';
      filter.frequency.value = 3200;

      const gain = this.ctx.createGain();
      gain.gain.setValueAtTime(0.05, now);
      gain.gain.exponentialRampToValueAtTime(1e-4, now + 0.06);

      noise.connect(filter);
      filter.connect(gain);
      gain.connect(this.mainGain);
      noise.start(now);
      noise.stop(now + 0.08);

      [
        [1975.5, 0.05, 0.9],
        [2637, 0.035, 1.1],
        [3520, 0.028, 1.3],
        [5274, 0.014, 1.5],
      ].forEach(([freq, vol, decay], idx) => {
        this._playSynthTone(freq, now + 0.03 * idx, vol, decay, 'sine', 1.04);
      });
    }

    confirm() {
      if (!this._canTrigger('confirm', 350)) return;
      const now = this.ctx.currentTime;
      this._playSynthTone(659.26, now, 0.07, 0.9, 'sine');
      this._playSynthTone(1318.5, now, 0.03, 0.9, 'triangle');
      this._playSynthTone(987.77, now + 0.16, 0.07, 1.2, 'sine');
      this._playSynthTone(1975.5, now + 0.16, 0.03, 1.2, 'triangle');
      [2637, 3520, 4186].forEach((freq, idx) => {
        this._playSynthTone(freq, now + 0.32 + 0.07 * idx, 0.02, 1.6, 'sine', 1.02);
      });
    }

    reverse() {
      if (!this._canTrigger('reverse', 300)) return;
      const now = this.ctx.currentTime;
      [
        [2637, 0.04],
        [1975.5, 0.05],
        [1318.5, 0.045],
      ].forEach(([freq, vol], idx) => {
        const osc = this.ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, now);
        osc.frequency.exponentialRampToValueAtTime(0.94 * freq, now + 0.7);

        const gain = this.ctx.createGain();
        gain.gain.setValueAtTime(1e-4, now);
        gain.gain.exponentialRampToValueAtTime(vol, now + 0.45 + 0.05 * idx);
        gain.gain.exponentialRampToValueAtTime(1e-4, now + 0.85);

        osc.connect(gain);
        gain.connect(this.mainGain);
        osc.start(now);
        osc.stop(now + 0.9);
      });
    }

    playConstellationChime() {
      if (!this.isEnabled || !this.ctx) return;
      const now = this.ctx.currentTime;
      [784, 1176].forEach((freq, idx) => {
        const osc = this.ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.value = freq;

        const gain = this.ctx.createGain();
        gain.gain.setValueAtTime(0, now);
        gain.gain.linearRampToValueAtTime(0.05 / (idx + 1), now + 0.02);
        gain.gain.exponentialRampToValueAtTime(1e-4, now + 1.9);

        osc.connect(gain);
        gain.connect(this.masterGain);
        osc.start(now);
        osc.stop(now + 2.0);
      });
    }

    report(metric, value) {
      this.telemetryMetrics[metric] = {
        v: clamp(value, 0, 1),
        t: performance.now(),
      };
    }

    debug() {
      return {
        built: this.isBuilt,
        notes: this.notesCount,
        chord: this.chordIndex,
        v: this.dynamicParams ? +this.dynamicParams.v.toFixed(3) : null,
        gain: this.dynamicParams ? +this.dynamicParams.g.gain.value.toFixed(4) : null,
        src: Object.fromEntries(
          Object.entries(this.telemetryMetrics).map(([k, t]) => [k, +t.v.toFixed(2)]),
        ),
        state: this.ctx ? this.ctx.state : null,
      };
    }
  }

  const instance = new SoundEngine();
  instance.CHORD_PRESETS = CHORD_PRESETS;
  instance.SoundEngine = SoundEngine;
  return instance;
});
