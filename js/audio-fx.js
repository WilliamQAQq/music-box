(function (global) {
  "use strict";

  const ns = global.__MusicBox || (global.__MusicBox = {});
  const { KEYS, storageGet, storageSet, setPressedButtonState } = ns.catalog;

  const BASE_VINYL_NOISE_GAIN = 0.045;
  const BYPASS_DISCONNECT_DELAY_MS = 140;

  function safeDisconnect(fromNode, toNode) {
    if (!fromNode) return;
    try {
      if (toNode) fromNode.disconnect(toNode);
      else fromNode.disconnect();
    } catch (e) { /* already disconnected */ }
  }

  function safeStopSource(src) {
    if (!src) return;
    try { src.stop(); } catch (e) { /* already stopped */ }
    safeDisconnect(src);
  }

  /**
   * 生成 6 秒无缝双声道黑胶摩擦底噪与瞬态炒豆脉冲缓冲：
   * - IIR 粉红滤波器先预热 4096 样本消除起音瞬变；
   * - 爆音与 33.3 RPM 微划痕按长度取模循环写入，并在首尾 40ms 执行等功率余弦交叉淡化，
   *   彻底消除 6 秒循环接缝处咔哒声。
   */
  function createVinylNoiseBuffer(ctx) {
    const sampleRate = ctx.sampleRate;
    const length = Math.max(sampleRate * 4, Math.floor(sampleRate * 6));
    const fadeLen = Math.min(Math.floor(sampleRate * 0.045), Math.floor(length / 8));
    const totalGen = length + fadeLen;
    const raw0 = new Float32Array(totalGen);
    const raw1 = new Float32Array(totalGen);

    let b0_0 = 0, b1_0 = 0, b2_0 = 0;
    let b0_1 = 0, b1_1 = 0, b2_1 = 0;

    // 预热滤波器状态，避免第 0 采样点从零电平突变
    for (let w = 0; w < 4096; w++) {
      const n0 = Math.random() * 2 - 1;
      const n1 = Math.random() * 2 - 1;
      b0_0 = 0.992 * b0_0 + n0 * 0.055;
      b1_0 = 0.96 * b1_0 + n0 * 0.075;
      b2_0 = 0.85 * b2_0 + n0 * 0.15;
      b0_1 = 0.992 * b0_1 + n1 * 0.055;
      b1_1 = 0.96 * b1_1 + n1 * 0.075;
      b2_1 = 0.85 * b2_1 + n1 * 0.15;
    }

    const rpmPeriod = sampleRate * (60 / 33.333);
    const motorFreq = (2 * Math.PI * 58) / sampleRate;

    for (let i = 0; i < totalGen; i++) {
      const w0 = Math.random() * 2 - 1;
      const w1 = Math.random() * 2 - 1;

      b0_0 = 0.992 * b0_0 + w0 * 0.055;
      b1_0 = 0.96 * b1_0 + w0 * 0.075;
      b2_0 = 0.85 * b2_0 + w0 * 0.15;
      const p0 = (b0_0 + b1_0 + b2_0) * 0.055;

      b0_1 = 0.992 * b0_1 + w1 * 0.055;
      b1_1 = 0.96 * b1_1 + w1 * 0.075;
      b2_1 = 0.85 * b2_1 + w1 * 0.15;
      const p1 = (b0_1 + b1_1 + b2_1) * 0.055;

      const rotPhase = (i % rpmPeriod) / rpmPeriod;
      const rotMod = 1 + 0.2 * Math.sin(rotPhase * Math.PI * 2);
      const motorMurmur = Math.sin(i * motorFreq) * 0.0022;

      raw0[i] = p0 * rotMod * 0.155 + motorMurmur;
      raw1[i] = p1 * rotMod * 0.155 + motorMurmur * 0.92;
    }

    // 环绕写入随机尘粒爆音
    const numClicks = Math.floor(length * (5.0 / sampleRate));
    for (let c = 0; c < numClicks; c++) {
      const clickPos = Math.floor(Math.random() * length);
      const isPop = Math.random() < 0.15;
      const strength = isPop ? (0.14 + Math.random() * 0.23) : (0.03 + Math.random() * 0.075);
      const sign = Math.random() > 0.5 ? 1 : -1;
      const pan = Math.random();
      const decaySamples = isPop ? 42 : 16;

      for (let j = 0; j < decaySamples; j++) {
        const idx = (clickPos + j) % length;
        const env = Math.exp(-j / (decaySamples * 0.26));
        const val = sign * strength * env * (Math.random() * 0.5 + 0.5);
        raw0[idx] += val * (1 - pan);
        raw1[idx] += val * pan;
      }
    }

    // 周期性转盘微划痕
    const scratchPhase = Math.floor(sampleRate * 0.38);
    const rotCount = Math.max(1, Math.floor(length / rpmPeriod));
    for (let r = 0; r < rotCount; r++) {
      const basePos = Math.floor(r * rpmPeriod + scratchPhase);
      for (let j = 0; j < 28; j++) {
        const idx = (basePos + j) % length;
        const env = Math.exp(-j / 8);
        const val = 0.082 * env * (Math.random() * 0.5 + 0.5);
        raw0[idx] += val;
        raw1[idx] += val * 0.65;
      }
    }

    // 在 [0, fadeLen) 处平滑叠混尾部样本 [length, length + fadeLen)，实现真正的零接缝循环
    const buffer = ctx.createBuffer(2, length, sampleRate);
    const ch0 = buffer.getChannelData(0);
    const ch1 = buffer.getChannelData(1);
    ch0.set(raw0.subarray(0, length));
    ch1.set(raw1.subarray(0, length));

    for (let i = 0; i < fadeLen; i++) {
      const t = i / fadeLen;
      const fadeIn = Math.sin(t * Math.PI * 0.5);
      const fadeOut = Math.cos(t * Math.PI * 0.5);
      ch0[i] = ch0[i] * fadeIn + raw0[length + i] * fadeOut;
      ch1[i] = ch1[i] * fadeIn + raw1[length + i] * fadeOut;
    }

    return buffer;
  }

  /**
   * 混合经典对称胆管 tanh 与轻微偶次谐波温暖曲率，并精确归零 DC 中心偏置。
   */
  function makeVinylSaturationCurve() {
    const n = 4096;
    const curve = new Float32Array(n);
    const norm = Math.tanh(1.25);
    const rawEval = (x) => (Math.tanh(x * 1.25) / norm) * 0.94 + 0.055 * x * x;
    const dcOffset = rawEval(0);
    for (let i = 0; i < n; i++) {
      const x = (i * 2) / (n - 1) - 1;
      const shaped = rawEval(x) - dcOffset;
      curve[i] = Math.max(-1, Math.min(1, shaped));
    }
    return curve;
  }

  const EQ_PRESETS = {
    flat: { label: "原声平直", bass: 0, mid: 0, treble: 0 },
    warm: { label: "维多利亚暖声", bass: 4.5, mid: 1.5, treble: -2.5 },
    jazz: { label: "沙龙爵士厅", bass: 3, mid: 2, treble: 2.5 },
    rock: { label: "炽焰摇滚夜", bass: 5, mid: -1.5, treble: 4 },
    vocal: { label: "丝绒人声", bass: -2, mid: 4.5, treble: 2 },
  };

  function safeParseJson(raw, fallback) {
    if (!raw) return fallback;
    try {
      const p = JSON.parse(raw);
      return p == null ? fallback : p;
    } catch (e) {
      return fallback;
    }
  }

  function clampNum(v, min, max, fallback) {
    const n = Number(v);
    return isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
  }

  function createAudioFxController(options) {
    const audio = options.audio;
    const vinylBtn = options.vinylBtn;
    const synthBtn = options.synthBtn;
    const toast = options.toast;

    let vinylFxEnabled = storageGet(KEYS.VINYL_FX, "0") === "1";
    let synthFxEnabled = storageGet(KEYS.SYNTH_FX, "0") === "1";

    const savedEq = safeParseJson(storageGet(KEYS.EQ, ""), {});
    const eqState = {
      bass: clampNum(savedEq.bass, -12, 12, 0),
      mid: clampNum(savedEq.mid, -12, 12, 0),
      treble: clampNum(savedEq.treble, -12, 12, 0),
    };

    const savedMix = safeParseJson(storageGet(KEYS.FX_MIX, ""), {});
    const mixState = {
      vinyl: clampNum(savedMix.vinyl, 0.2, 1.5, 1.0),
      synth: clampNum(savedMix.synth, 0.2, 1.5, 1.0),
    };

    let audioCtx = null;
    let baseGraph = null;
    let synthNodes = null;
    let vinylNodes = null;
    let eqNodes = null;
    let analyserNode = null;
    let vinylNoiseBuffer = null;

    let synthConnected = false;
    let vinylConnected = false;
    let eqConnected = false;
    let analyserWanted = false;
    let analyserConnected = false;
    let synthDisconnectTimer = null;
    let vinylDisconnectTimer = null;
    let audioSuspendTimer = null;

    let sleepFadeFactor = 1;
    let transitionFadeFactor = 1;
    let fadeOutRestoreTimer = null;
    let fadeInUntilMs = 0;

    function isEqActive() {
      return Math.abs(eqState.bass) >= 0.05 || Math.abs(eqState.mid) >= 0.05 || Math.abs(eqState.treble) >= 0.05;
    }

    function needsAudioGraph() {
      return !!(vinylFxEnabled || synthFxEnabled || isEqActive() || analyserWanted);
    }

    function ensureBaseGraph() {
      if (baseGraph) return true;
      try {
        const AudioContextClass = global.AudioContext || global.webkitAudioContext;
        if (!AudioContextClass) return false;
        if (!audioCtx) audioCtx = new AudioContextClass();

        const source = audioCtx.createMediaElementSource(audio);

        // 第一级总线(原声 vs 合成器重合成)
        const stage1DryGain = audioCtx.createGain();
        stage1DryGain.gain.value = 1;
        const stage1Bus = audioCtx.createGain();
        stage1Bus.gain.value = 1;
        source.connect(stage1DryGain);
        stage1DryGain.connect(stage1Bus);

        // 第二级总线(第一级输出 vs 黑胶留声机)
        const stage2DryGain = audioCtx.createGain();
        stage2DryGain.gain.value = 1;
        const postStage2Bus = audioCtx.createGain();
        postStage2Bus.gain.value = 1;
        stage1Bus.connect(stage2DryGain);
        stage2DryGain.connect(postStage2Bus);

        // EQ 旁路直通增益与主淡入淡出保护增益
        const eqDryGain = audioCtx.createGain();
        eqDryGain.gain.value = 1;
        const masterGain = audioCtx.createGain();
        masterGain.gain.value = 1;

        postStage2Bus.connect(eqDryGain);
        eqDryGain.connect(masterGain);
        masterGain.connect(audioCtx.destination);

        baseGraph = {
          source,
          stage1DryGain,
          stage1Bus,
          stage2DryGain,
          postStage2Bus,
          eqDryGain,
          masterGain,
        };
        return true;
      } catch (e) {
        console.warn("Web Audio base graph unavailable:", e);
        return false;
      }
    }

    function buildSynthNodes() {
      if (synthNodes) return true;
      if (!ensureBaseGraph()) return false;
      try {
        const inputTrim = audioCtx.createGain();
        inputTrim.gain.value = 0.88;

        const hpFilter = audioCtx.createBiquadFilter();
        hpFilter.type = "highpass";
        hpFilter.frequency.value = 60;
        hpFilter.Q.value = 0.707;

        const bassShelf = audioCtx.createBiquadFilter();
        bassShelf.type = "lowshelf";
        bassShelf.frequency.value = 135;
        bassShelf.gain.value = 2.8;

        const bassPunch = audioCtx.createBiquadFilter();
        bassPunch.type = "peaking";
        bassPunch.frequency.value = 95;
        bassPunch.Q.value = 1.25;
        bassPunch.gain.value = 1.8;

        inputTrim.connect(hpFilter);
        hpFilter.connect(bassShelf);
        bassShelf.connect(bassPunch);

        // 6 级异步正交全通 PWM 梳状矩阵 (奇偶双 LFO 交错反相扫频，音色更浑厚而不尖利)
        const pwmBus = audioCtx.createGain();
        pwmBus.gain.value = 1.0;

        const pwmDry = audioCtx.createGain();
        pwmDry.gain.value = 0.50;
        bassPunch.connect(pwmDry);
        pwmDry.connect(pwmBus);

        const apFreqs = [240, 480, 920, 1580, 2450, 3400];
        const apDepths = [80, 150, 270, 450, 680, 900];
        const apGains = [];
        const apFilters = [];

        let prevAp = bassPunch;
        apFreqs.forEach((f, idx) => {
          const ap = audioCtx.createBiquadFilter();
          ap.type = "allpass";
          ap.frequency.value = f;
          ap.Q.value = 1.7;

          const lfoGain = audioCtx.createGain();
          lfoGain.gain.value = (idx % 2 === 0 ? 1 : -1) * apDepths[idx];
          lfoGain.connect(ap.frequency);

          prevAp.connect(ap);
          prevAp = ap;
          apFilters.push(ap);
          apGains.push(lfoGain);
        });

        const pwmWet = audioCtx.createGain();
        pwmWet.gain.value = 0.50;
        prevAp.connect(pwmWet);
        pwmWet.connect(pwmBus);

        // 合成器双共振峰雕刻 + 轻柔空气感高架 + 24dB/oct 双级联 Moog VCF
        const formantPad = audioCtx.createBiquadFilter();
        formantPad.type = "peaking";
        formantPad.frequency.value = 500;
        formantPad.Q.value = 1.45;
        formantPad.gain.value = 2.2;

        const formantLead = audioCtx.createBiquadFilter();
        formantLead.type = "peaking";
        formantLead.frequency.value = 1280;
        formantLead.Q.value = 1.75;
        formantLead.gain.value = 2.5;

        const deHarsh = audioCtx.createBiquadFilter();
        deHarsh.type = "peaking";
        deHarsh.frequency.value = 3000;
        deHarsh.Q.value = 1.4;
        deHarsh.gain.value = -2.8;

        const airShelf = audioCtx.createBiquadFilter();
        airShelf.type = "highshelf";
        airShelf.frequency.value = 7400;
        airShelf.gain.value = 1.6;

        const vcfLp1 = audioCtx.createBiquadFilter();
        vcfLp1.type = "lowpass";
        vcfLp1.frequency.value = 3450;
        vcfLp1.Q.value = 1.25;

        const vcfLp2 = audioCtx.createBiquadFilter();
        vcfLp2.type = "lowpass";
        vcfLp2.frequency.value = 3450;
        vcfLp2.Q.value = 1.25;

        const vcfLfoGain = audioCtx.createGain();
        vcfLfoGain.gain.value = 700;
        vcfLfoGain.connect(vcfLp1.frequency);
        vcfLfoGain.connect(vcfLp2.frequency);

        pwmBus.connect(formantPad);
        formantPad.connect(formantLead);
        formantLead.connect(deHarsh);
        deHarsh.connect(airShelf);
        airShelf.connect(vcfLp1);
        vcfLp1.connect(vcfLp2);

        // 3 声部 Juno 立体声正交复音合唱
        const synthStereoMix = audioCtx.createGain();
        synthStereoMix.gain.value = 1.0;

        const ensembleDry = audioCtx.createGain();
        ensembleDry.gain.value = 0.36;
        vcfLp2.connect(ensembleDry);
        ensembleDry.connect(synthStereoMix);

        const chorusPreLp = audioCtx.createBiquadFilter();
        chorusPreLp.type = "lowpass";
        chorusPreLp.frequency.value = 3800;
        chorusPreLp.Q.value = 0.707;
        vcfLp2.connect(chorusPreLp);

        const delayL = audioCtx.createDelay(0.05);
        delayL.delayTime.value = 0.0095;
        const delayR = audioCtx.createDelay(0.05);
        delayR.delayTime.value = 0.0130;
        const delayC = audioCtx.createDelay(0.05);
        delayC.delayTime.value = 0.0165;

        const depthL = audioCtx.createGain();
        depthL.gain.value = 0.0014;
        depthL.connect(delayL.delayTime);
        const depthR = audioCtx.createGain();
        depthR.gain.value = -0.0014;
        depthR.connect(delayR.delayTime);
        const depthC = audioCtx.createGain();
        depthC.gain.value = 0.00095;
        depthC.connect(delayC.delayTime);

        const gainL = audioCtx.createGain();
        gainL.gain.value = 0.36;
        const gainR = audioCtx.createGain();
        gainR.gain.value = 0.36;
        const gainC = audioCtx.createGain();
        gainC.gain.value = 0.24;

        chorusPreLp.connect(delayL);
        chorusPreLp.connect(delayR);
        chorusPreLp.connect(delayC);

        if (typeof audioCtx.createStereoPanner === "function") {
          const panL = audioCtx.createStereoPanner();
          panL.pan.value = -0.84;
          const panR = audioCtx.createStereoPanner();
          panR.pan.value = 0.84;
          delayL.connect(panL);
          panL.connect(gainL);
          delayR.connect(panR);
          panR.connect(gainR);
        } else {
          delayL.connect(gainL);
          delayR.connect(gainR);
        }
        delayC.connect(gainC);

        gainL.connect(synthStereoMix);
        gainR.connect(synthStereoMix);
        gainC.connect(synthStereoMix);

        // 丝绒带限空间回声
        const echoDelay = audioCtx.createDelay(0.5);
        echoDelay.delayTime.value = 0.165;
        const echoHp = audioCtx.createBiquadFilter();
        echoHp.type = "highpass";
        echoHp.frequency.value = 220;
        const echoLp = audioCtx.createBiquadFilter();
        echoLp.type = "lowpass";
        echoLp.frequency.value = 1900;
        const echoFeedback = audioCtx.createGain();
        echoFeedback.gain.value = 0.14;
        const echoWet = audioCtx.createGain();
        echoWet.gain.value = 0.12;

        vcfLp2.connect(echoDelay);
        echoDelay.connect(echoHp);
        echoHp.connect(echoLp);
        echoLp.connect(echoFeedback);
        echoFeedback.connect(echoDelay);
        echoLp.connect(echoWet);
        echoWet.connect(synthStereoMix);

        // 动态保护与响度均衡
        const outComp = audioCtx.createDynamicsCompressor();
        outComp.threshold.value = -12;
        outComp.knee.value = 14;
        outComp.ratio.value = 2.5;
        outComp.attack.value = 0.008;
        outComp.release.value = 0.16;

        const makeupGain = audioCtx.createGain();
        makeupGain.gain.value = 0.94;

        const wetGain = audioCtx.createGain();
        wetGain.gain.value = 0;

        synthStereoMix.connect(outComp);
        outComp.connect(makeupGain);
        makeupGain.connect(wetGain);

        synthNodes = {
          inputTrim,
          wetGain,
          apGains,
          vcfLfoGain,
          depthL,
          depthR,
          depthC,
          lfos: [],
        };
        return true;
      } catch (e) {
        console.warn("Synthesizer audio emulation unavailable:", e);
        return false;
      }
    }

    function connectSynthBranch() {
      clearTimeout(synthDisconnectTimer);
      synthDisconnectTimer = null;
      if (!buildSynthNodes()) return false;
      if (!synthConnected) {
        baseGraph.source.connect(synthNodes.inputTrim);
        synthNodes.wetGain.connect(baseGraph.stage1Bus);

        const pwmLfoA = audioCtx.createOscillator();
        pwmLfoA.type = "sine";
        pwmLfoA.frequency.value = 0.31;

        const pwmLfoB = audioCtx.createOscillator();
        pwmLfoB.type = "sine";
        pwmLfoB.frequency.value = 0.47;

        synthNodes.apGains.forEach((g, idx) => {
          (idx % 2 === 0 ? pwmLfoA : pwmLfoB).connect(g);
        });

        const vcfLfo = audioCtx.createOscillator();
        vcfLfo.type = "sine";
        vcfLfo.frequency.value = 0.21;
        vcfLfo.connect(synthNodes.vcfLfoGain);

        const chorusLfo1 = audioCtx.createOscillator();
        chorusLfo1.type = "sine";
        chorusLfo1.frequency.value = 0.52;
        chorusLfo1.connect(synthNodes.depthL);
        chorusLfo1.connect(synthNodes.depthR);

        const chorusLfo2 = audioCtx.createOscillator();
        chorusLfo2.type = "sine";
        chorusLfo2.frequency.value = 0.86;
        chorusLfo2.connect(synthNodes.depthC);

        const activeLfos = [pwmLfoA, pwmLfoB, vcfLfo, chorusLfo1, chorusLfo2];
        activeLfos.forEach((osc) => osc.start());
        synthNodes.lfos = activeLfos;
        synthConnected = true;
      }
      return true;
    }

    function disconnectSynthBranchImmediate() {
      if (!synthNodes || !synthConnected) return;
      safeDisconnect(baseGraph.source, synthNodes.inputTrim);
      safeDisconnect(synthNodes.wetGain, baseGraph.stage1Bus);
      synthNodes.lfos.forEach(safeStopSource);
      synthNodes.lfos = [];
      synthConnected = false;
    }

    function scheduleSynthDisconnect() {
      clearTimeout(synthDisconnectTimer);
      if (!synthConnected) return;
      synthDisconnectTimer = setTimeout(() => {
        synthDisconnectTimer = null;
        if (!synthFxEnabled) disconnectSynthBranchImmediate();
      }, BYPASS_DISCONNECT_DELAY_MS);
    }

    function buildVinylNodes() {
      if (vinylNodes) return true;
      if (!ensureBaseGraph()) return false;
      try {
        const wetGain = audioCtx.createGain();
        wetGain.gain.value = 0;

        const hp = audioCtx.createBiquadFilter();
        hp.type = "highpass";
        hp.frequency.value = 52;
        hp.Q.value = 0.7;

        const warmShelf = audioCtx.createBiquadFilter();
        warmShelf.type = "lowshelf";
        warmShelf.frequency.value = 180;
        warmShelf.gain.value = 2.2;

        const midRes = audioCtx.createBiquadFilter();
        midRes.type = "peaking";
        midRes.frequency.value = 2200;
        midRes.gain.value = 1.6;
        midRes.Q.value = 1.0;

        const lp = audioCtx.createBiquadFilter();
        lp.type = "lowpass";
        lp.frequency.value = 6800;
        lp.Q.value = 1.0;

        const shaper = audioCtx.createWaveShaper();
        shaper.curve = makeVinylSaturationCurve();
        shaper.oversample = "2x";

        const delay = audioCtx.createDelay();
        delay.delayTime.value = 0.015;

        const wowGain = audioCtx.createGain();
        wowGain.gain.value = 0.00028;
        wowGain.connect(delay.delayTime);

        const flutterGain = audioCtx.createGain();
        flutterGain.gain.value = 0.00006;
        flutterGain.connect(delay.delayTime);

        hp.connect(warmShelf);
        warmShelf.connect(midRes);
        midRes.connect(lp);
        lp.connect(shaper);
        shaper.connect(delay);
        delay.connect(wetGain);

        const noiseHp = audioCtx.createBiquadFilter();
        noiseHp.type = "highpass";
        noiseHp.frequency.value = 140;

        const noiseLp = audioCtx.createBiquadFilter();
        noiseLp.type = "lowpass";
        noiseLp.frequency.value = 2800;

        const noiseGain = audioCtx.createGain();
        noiseGain.gain.value = 0;

        noiseHp.connect(noiseLp);
        noiseLp.connect(noiseGain);

        vinylNodes = {
          hp,
          wetGain,
          wowGain,
          flutterGain,
          noiseHp,
          noiseGain,
          noiseSource: null,
          lfos: [],
        };
        return true;
      } catch (e) {
        console.warn("Vinyl audio emulation unavailable:", e);
        return false;
      }
    }

    function connectVinylBranch() {
      clearTimeout(vinylDisconnectTimer);
      vinylDisconnectTimer = null;
      if (!buildVinylNodes()) return false;
      if (!vinylConnected) {
        if (!vinylNoiseBuffer) vinylNoiseBuffer = createVinylNoiseBuffer(audioCtx);

        baseGraph.stage1Bus.connect(vinylNodes.hp);
        vinylNodes.wetGain.connect(baseGraph.postStage2Bus);
        vinylNodes.noiseGain.connect(baseGraph.postStage2Bus);

        const wowOsc = audioCtx.createOscillator();
        wowOsc.frequency.value = 0.555;
        wowOsc.connect(vinylNodes.wowGain);

        const flutterOsc = audioCtx.createOscillator();
        flutterOsc.type = "triangle";
        flutterOsc.frequency.value = 4.8;
        flutterOsc.connect(vinylNodes.flutterGain);

        const noiseSource = audioCtx.createBufferSource();
        noiseSource.buffer = vinylNoiseBuffer;
        noiseSource.loop = true;
        noiseSource.connect(vinylNodes.noiseHp);

        wowOsc.start();
        flutterOsc.start();
        noiseSource.start();

        vinylNodes.noiseSource = noiseSource;
        vinylNodes.lfos = [wowOsc, flutterOsc];
        vinylConnected = true;
      }
      return true;
    }

    function disconnectVinylBranchImmediate() {
      if (!vinylNodes || !vinylConnected) return;
      safeDisconnect(baseGraph.stage1Bus, vinylNodes.hp);
      safeDisconnect(vinylNodes.wetGain, baseGraph.postStage2Bus);
      safeDisconnect(vinylNodes.noiseGain, baseGraph.postStage2Bus);
      safeStopSource(vinylNodes.noiseSource);
      vinylNodes.lfos.forEach(safeStopSource);
      vinylNodes.noiseSource = null;
      vinylNodes.lfos = [];
      vinylConnected = false;
    }

    function scheduleVinylDisconnect() {
      clearTimeout(vinylDisconnectTimer);
      if (!vinylConnected) return;
      vinylDisconnectTimer = setTimeout(() => {
        vinylDisconnectTimer = null;
        if (!vinylFxEnabled) disconnectVinylBranchImmediate();
      }, BYPASS_DISCONNECT_DELAY_MS);
    }

    function buildEqNodes() {
      if (eqNodes) return true;
      if (!ensureBaseGraph()) return false;
      try {
        const low = audioCtx.createBiquadFilter();
        low.type = "lowshelf";
        low.frequency.value = 115;
        low.gain.value = eqState.bass;

        const mid = audioCtx.createBiquadFilter();
        mid.type = "peaking";
        mid.frequency.value = 1000;
        mid.Q.value = 0.85;
        mid.gain.value = eqState.mid;

        const high = audioCtx.createBiquadFilter();
        high.type = "highshelf";
        high.frequency.value = 6000;
        high.gain.value = eqState.treble;

        const wetGain = audioCtx.createGain();
        wetGain.gain.value = 0;

        low.connect(mid);
        mid.connect(high);
        high.connect(wetGain);

        eqNodes = { low, mid, treble: high, wetGain };
        return true;
      } catch (e) {
        return false;
      }
    }

    function syncEqBranch() {
      const wantEq = isEqActive();
      if (wantEq && !audio.paused) {
        if (buildEqNodes() && !eqConnected) {
          baseGraph.postStage2Bus.connect(eqNodes.low);
          eqNodes.wetGain.connect(baseGraph.masterGain);
          eqConnected = true;
        }
      }
      if (!baseGraph || !audioCtx) return;
      const time = audioCtx.currentTime;
      const useEq = !!(wantEq && eqConnected && eqNodes);
      baseGraph.eqDryGain.gain.setTargetAtTime(useEq ? 0 : 1, time, 0.02);
      if (eqNodes) {
        eqNodes.low.gain.setTargetAtTime(eqState.bass, time, 0.02);
        eqNodes.mid.gain.setTargetAtTime(eqState.mid, time, 0.02);
        eqNodes.treble.gain.setTargetAtTime(eqState.treble, time, 0.02);
        eqNodes.wetGain.gain.setTargetAtTime(useEq ? 1 : 0, time, 0.02);
        if (!wantEq && eqConnected) {
          safeDisconnect(baseGraph.postStage2Bus, eqNodes.low);
          safeDisconnect(eqNodes.wetGain, baseGraph.masterGain);
          eqConnected = false;
        }
      }
    }

    function syncAnalyserBranch() {
      if (analyserWanted && !audio.paused) {
        if (!ensureBaseGraph()) return false;
        if (!analyserNode) {
          analyserNode = audioCtx.createAnalyser();
          analyserNode.fftSize = 128;
          analyserNode.smoothingTimeConstant = 0.78;
        }
        if (!analyserConnected) {
          baseGraph.masterGain.connect(analyserNode);
          analyserConnected = true;
        }
      } else if (analyserConnected && baseGraph && analyserNode) {
        safeDisconnect(baseGraph.masterGain, analyserNode);
        analyserConnected = false;
      }
      return analyserConnected;
    }

    function getTargetNoiseGain() {
      if (!vinylFxEnabled || audio.paused || audio.volume <= 0) return 0;
      const baseVol = typeof options.getBaseVolume === "function" ? options.getBaseVolume() : audio.volume;
      return BASE_VINYL_NOISE_GAIN * Math.min(1, Math.max(0, baseVol)) * mixState.vinyl;
    }

    function applyMasterFade(immediate) {
      if (!immediate && Date.now() < fadeInUntilMs) return;
      const target = Math.max(0.015, Math.min(1, sleepFadeFactor * transitionFadeFactor));
      if (baseGraph && audioCtx) {
        const time = audioCtx.currentTime;
        baseGraph.masterGain.gain.setTargetAtTime(target, time, immediate ? 0.008 : 0.035);
      } else if (typeof options.onFallbackGainChange === "function") {
        options.onFallbackGainChange(target);
      }
    }

    function updateGraph(immediate) {
      if (synthFxEnabled && !audio.paused) connectSynthBranch();
      if (vinylFxEnabled && !audio.paused) connectVinylBranch();
      syncEqBranch();
      syncAnalyserBranch();

      if (!baseGraph || !audioCtx) {
        applyMasterFade(immediate);
        return;
      }
      const time = audioCtx.currentTime;
      const rampTime = immediate ? 0.005 : 0.035;

      const useSynth = !!(synthFxEnabled && synthConnected && synthNodes);
      const sMix = Math.max(0.2, Math.min(1.5, mixState.synth));
      const synthDry = useSynth ? Math.max(0, 1 - sMix) : 1;
      const synthWet = useSynth ? Math.min(1.18, sMix) : 0;
      baseGraph.stage1DryGain.gain.setTargetAtTime(synthDry, time, rampTime);
      if (synthNodes) {
        synthNodes.wetGain.gain.setTargetAtTime(synthWet, time, rampTime);
        if (!synthFxEnabled && synthConnected) scheduleSynthDisconnect();
      }

      const useVinyl = !!(vinylFxEnabled && vinylConnected && vinylNodes);
      baseGraph.stage2DryGain.gain.setTargetAtTime(useVinyl ? 0 : 1, time, rampTime);
      if (vinylNodes) {
        vinylNodes.wetGain.gain.setTargetAtTime(useVinyl ? 1 : 0, time, rampTime);
        vinylNodes.noiseGain.gain.setTargetAtTime(getTargetNoiseGain(), time, rampTime);
        vinylNodes.wowGain.gain.setTargetAtTime(0.00028 * mixState.vinyl, time, rampTime);
        vinylNodes.flutterGain.gain.setTargetAtTime(0.00006 * mixState.vinyl, time, rampTime);
        if (!vinylFxEnabled && vinylConnected) scheduleVinylDisconnect();
      }

      applyMasterFade(immediate);
    }

    function ensureResumed() {
      clearTimeout(audioSuspendTimer);
      audioSuspendTimer = null;
      if (audioCtx && audioCtx.state === "suspended") {
        audioCtx.resume().catch(() => {});
      }
    }

    function scheduleSuspend() {
      clearTimeout(audioSuspendTimer);
      if (!audioCtx) return;
      audioSuspendTimer = setTimeout(() => {
        audioSuspendTimer = null;
        if (audio.paused && audioCtx && audioCtx.state === "running") {
          audioCtx.suspend().catch(() => {});
        }
      }, 300);
    }

    function syncUI() {
      setPressedButtonState(vinylBtn, vinylFxEnabled);
      document.body.classList.toggle("vinyl-fx-active", vinylFxEnabled);
      setPressedButtonState(synthBtn, synthFxEnabled);
      document.body.classList.toggle("synth-fx-active", synthFxEnabled);
    }

    function toggleVinylFx() {
      vinylFxEnabled = !vinylFxEnabled;
      storageSet(KEYS.VINYL_FX, vinylFxEnabled ? "1" : "0");
      if (!audio.paused) {
        if (vinylFxEnabled) connectVinylBranch();
        ensureResumed();
        updateGraph(false);
      } else if (!vinylFxEnabled && vinylConnected) {
        updateGraph(true);
      }
      syncUI();
      if (toast) {
        toast(vinylFxEnabled ? "已开启黑胶唱片音效 · 温暖模拟与唱针底噪" : "已关闭黑胶音效 · 还原数码原声");
      }
    }

    function toggleSynthFx() {
      synthFxEnabled = !synthFxEnabled;
      storageSet(KEYS.SYNTH_FX, synthFxEnabled ? "1" : "0");
      if (!audio.paused) {
        if (synthFxEnabled) connectSynthBranch();
        ensureResumed();
        updateGraph(false);
      } else if (!synthFxEnabled && synthConnected) {
        updateGraph(true);
      }
      syncUI();
      if (toast) {
        toast(synthFxEnabled ? "已开启合成器模式 · 模拟 PWM 相位共振与复音合唱" : "已关闭合成器模式 · 还原原始乐器音色");
      }
    }

    function setEqBand(band, db) {
      if (band !== "bass" && band !== "mid" && band !== "treble") return;
      eqState[band] = clampNum(db, -12, 12, 0);
      storageSet(KEYS.EQ, JSON.stringify(eqState));
      if (!audio.paused && isEqActive()) ensureResumed();
      updateGraph(false);
    }

    function applyEqPreset(presetId) {
      const p = EQ_PRESETS[presetId] || EQ_PRESETS.flat;
      eqState.bass = p.bass;
      eqState.mid = p.mid;
      eqState.treble = p.treble;
      storageSet(KEYS.EQ, JSON.stringify(eqState));
      if (!audio.paused && isEqActive()) ensureResumed();
      updateGraph(false);
      return getEqState();
    }

    function getEqState() {
      return { bass: eqState.bass, mid: eqState.mid, treble: eqState.treble, active: isEqActive() };
    }

    function setFxMix(kind, value) {
      if (kind !== "vinyl" && kind !== "synth") return;
      mixState[kind] = clampNum(value, 0.2, 1.5, 1.0);
      storageSet(KEYS.FX_MIX, JSON.stringify(mixState));
      updateGraph(false);
    }

    function getFxMix() {
      return { vinyl: mixState.vinyl, synth: mixState.synth };
    }

    function setAnalyserActive(on) {
      analyserWanted = !!on;
      if (analyserWanted && !audio.paused) ensureResumed();
      syncAnalyserBranch();
    }

    function readFrequencyData(outArr) {
      if (!analyserConnected || !analyserNode || !outArr) return false;
      analyserNode.getByteFrequencyData(outArr);
      return true;
    }

    function getFrequencyBinCount() {
      return analyserNode ? analyserNode.frequencyBinCount : 64;
    }

    function setSleepFadeFactor(factor) {
      sleepFadeFactor = clampNum(factor, 0.02, 1, 1);
      applyMasterFade(false);
    }

    function setTransitionFadeFactor(factor, immediate) {
      clearTimeout(fadeOutRestoreTimer);
      fadeOutRestoreTimer = null;
      fadeInUntilMs = 0;
      transitionFadeFactor = clampNum(factor, 0.02, 1, 1);
      applyMasterFade(!!immediate);
    }

    function fadeOutThenRun(durationMs, callback) {
      clearTimeout(fadeOutRestoreTimer);
      fadeInUntilMs = 0;
      const ms = Math.max(0, Number(durationMs) || 0);
      if (ms <= 20 || audio.paused) {
        if (callback) callback();
        return;
      }
      transitionFadeFactor = 0.05;
      if (baseGraph && audioCtx) {
        const t = audioCtx.currentTime;
        baseGraph.masterGain.gain.cancelScheduledValues(t);
        baseGraph.masterGain.gain.setValueAtTime(Math.max(0.05, baseGraph.masterGain.gain.value), t);
        baseGraph.masterGain.gain.linearRampToValueAtTime(0.03, t + ms / 1000);
      } else if (typeof options.onFallbackGainChange === "function") {
        options.onFallbackGainChange(0.15);
      }
      fadeOutRestoreTimer = setTimeout(() => {
        fadeOutRestoreTimer = null;
        if (callback) callback();
      }, ms);
    }

    function fadeInOver(durationMs) {
      clearTimeout(fadeOutRestoreTimer);
      const ms = Math.max(0, Number(durationMs) || 0);
      if (ms <= 30) {
        fadeInUntilMs = 0;
        transitionFadeFactor = 1;
        applyMasterFade(true);
        return;
      }
      fadeInUntilMs = Date.now() + ms;
      transitionFadeFactor = 1;
      const target = Math.max(0.02, Math.min(1, sleepFadeFactor));
      if (baseGraph && audioCtx) {
        const t = audioCtx.currentTime;
        baseGraph.masterGain.gain.cancelScheduledValues(t);
        baseGraph.masterGain.gain.setValueAtTime(0.05, t);
        baseGraph.masterGain.gain.linearRampToValueAtTime(target, t + ms / 1000);
      } else if (typeof options.onFallbackGainChange === "function") {
        options.onFallbackGainChange(0.18);
        fadeOutRestoreTimer = setTimeout(() => {
          fadeOutRestoreTimer = null;
          fadeInUntilMs = 0;
          if (typeof options.onFallbackGainChange === "function") options.onFallbackGainChange(target);
        }, Math.min(260, ms * 0.45));
      }
    }

    function onPlay() {
      if (needsAudioGraph()) {
        if (synthFxEnabled) connectSynthBranch();
        if (vinylFxEnabled) connectVinylBranch();
        ensureResumed();
      }
      updateGraph(false);
    }

    function onPlaying() {
      if (needsAudioGraph() || baseGraph) ensureResumed();
      updateGraph(false);
    }

    function onPauseOrEnd() {
      updateGraph(false);
      scheduleSuspend();
    }

    return {
      EQ_PRESETS,
      isVinylEnabled: () => vinylFxEnabled,
      isSynthEnabled: () => synthFxEnabled,
      isSynthConnected: () => synthConnected,
      isVinylConnected: () => vinylConnected,
      isEqActive,
      isEqConnected: () => eqConnected,
      isAnalyserConnected: () => analyserConnected,
      getEqState,
      setEqBand,
      applyEqPreset,
      getFxMix,
      setFxMix,
      setAnalyserActive,
      readFrequencyData,
      getFrequencyBinCount,
      setSleepFadeFactor,
      setTransitionFadeFactor,
      fadeOutThenRun,
      fadeInOver,
      updateGraph,
      ensureResumed,
      scheduleSuspend,
      syncUI,
      toggleVinylFx,
      toggleSynthFx,
      onPlay,
      onPlaying,
      onPauseOrEnd,
    };
  }

  ns.createAudioFxController = createAudioFxController;
})(window);
