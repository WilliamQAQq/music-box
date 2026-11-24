(function (global) {
  "use strict";

  const ns = global.__MusicBox || (global.__MusicBox = {});
  const { KEYS, storageGet, storageSet, setPressedButtonState } = ns.catalog;

  const BASE_VINYL_NOISE_GAIN = 0.045;
  const BASE_RADIO_STATIC_GAIN = 0.036;
  const BASE_AMBIENT_GAIN = 0.42;
  const TARGET_AMBIENT_BUFFER_RMS = 0.065;
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
    const rawEval = (x) => (Math.tanh(x * 1.25) / norm) * 0.99 + 0.055 * x * x;
    const dcOffset = rawEval(0);
    for (let i = 0; i < n; i++) {
      const x = (i * 2) / (n - 1) - 1;
      const shaped = rawEval(x) - dcOffset;
      curve[i] = Math.max(-1, Math.min(1, shaped));
    }
    return curve;
  }

  /**
   * 按指定干扰模式生成 6 秒无缝无线电静电底噪、邻频差拍哨叫、磁暴雷电或航空塔台静噪缓冲：
   * - qrn: 天电静电 (电离层带通底噪 + 轻度天电脉冲 + 100Hz 电子管灯丝哼声)
   * - qrm: 邻频哨叫 (双载波差拍外差啸叫 + 790Hz 莫尔斯电报 CW 滴答电码 + 底噪)
   * - storm: 磁暴雷雨 (密集雷电静电猝发簇 + 太阳风暴深幅电离层湍流)
   * - cockpit: 塔台底噪 (VHF 鉴频高频嘶声 + 400Hz/800Hz 航空机载交流逆变器嗡声 + PTT 静噪尾音咔哒)
   * 首尾采用等功率余弦交叉淡化，确保循环无接缝。
   */
  function createRadioStaticBuffer(ctx, noiseMode) {
    const mode = noiseMode || "qrn";
    const sampleRate = ctx.sampleRate;
    const length = Math.max(sampleRate * 4, Math.floor(sampleRate * 6));
    const fadeLen = Math.min(Math.floor(sampleRate * 0.045), Math.floor(length / 8));
    const totalGen = length + fadeLen;
    const raw0 = new Float32Array(totalGen);
    const raw1 = new Float32Array(totalGen);

    let lp0 = 0;
    let lp1 = 0;
    const hum100 = (2 * Math.PI * 100) / sampleRate;
    const hum400 = (2 * Math.PI * 400) / sampleRate;
    const hum800 = (2 * Math.PI * 800) / sampleRate;
    const whistleA = (2 * Math.PI * (mode === "qrm" ? 1140 : 1740)) / sampleRate;
    const whistleB = (2 * Math.PI * (mode === "qrm" ? 2180 : 2460)) / sampleRate;
    const cwFreq = (2 * Math.PI * 790) / sampleRate;

    // 预生成 QRM 模式下的背景莫尔斯电报 (CW) 滴答包络时间表
    const cwPattern = [1, 0, 1, 1, 1, 0, 0, 1, 1, 1, 0, 1, 0, 1, 0, 0, 0, 1, 0, 1, 0, 0, 1, 1, 1, 0, 0, 0];
    const cwUnitSamples = Math.max(1, Math.floor(sampleRate * 0.068));

    for (let i = 0; i < totalGen; i++) {
      const w0 = Math.random() * 2 - 1;
      const w1 = Math.random() * 2 - 1;
      const sec = i / sampleRate;

      if (mode === "cockpit") {
        // VHF 甚高频/塔台鉴频高频预加重白噪 + 400Hz 机载航电交流嗡声
        lp0 = 0.52 * lp0 + 0.48 * w0;
        lp1 = 0.52 * lp1 + 0.48 * w1;
        const vhfHiss0 = (w0 - lp0 * 0.72) * 0.145;
        const vhfHiss1 = (w1 - lp1 * 0.72) * 0.145;
        const avionicsHum = Math.sin(i * hum400) * 0.0085 + Math.sin(i * hum800) * 0.0038;
        raw0[i] = vhfHiss0 + avionicsHum;
        raw1[i] = vhfHiss1 * 0.95 + vhfHiss0 * 0.05 + avionicsHum;
      } else if (mode === "qrm") {
        // 邻频双差拍哨叫 + 莫尔斯 CW 远距电报背景
        lp0 = 0.72 * lp0 + 0.28 * w0;
        lp1 = 0.72 * lp1 + 0.28 * w1;
        const bandNoise0 = (w0 - lp0 * 0.55) * 0.105;
        const bandNoise1 = (w1 - lp1 * 0.55) * 0.105;
        const warbleA = Math.sin(sec * Math.PI * 2 * 0.55) * 26;
        const warbleB = Math.cos(sec * Math.PI * 2 * 0.37) * 19;
        const beatWhistle =
          Math.sin(i * whistleA + warbleA) * 0.016 +
          Math.sin(i * whistleB - warbleB) * 0.0095;

        const cwSlot = Math.floor((i % length) / cwUnitSamples) % cwPattern.length;
        const cwPhaseInSlot = ((i % length) % cwUnitSamples) / cwUnitSamples;
        const cwEdge = Math.min(1, cwPhaseInSlot * 10, (1 - cwPhaseInSlot) * 10);
        const cwEnv = cwPattern[cwSlot] ? Math.max(0, cwEdge) : 0;
        const cwTone = Math.sin(i * cwFreq) * cwEnv * 0.015;

        raw0[i] = bandNoise0 + beatWhistle + cwTone;
        raw1[i] = bandNoise1 * 0.94 + bandNoise0 * 0.06 + beatWhistle * 0.92 + cwTone * 0.88;
      } else if (mode === "obstacle") {
        // 障碍物干扰：山体/隧道/高楼遮挡引起的瑞利多径栅栏扑哧衰落 (Picket-Fencing 14Hz–19Hz) 与临界捕获噪波
        lp0 = 0.62 * lp0 + 0.38 * w0;
        lp1 = 0.62 * lp1 + 0.38 * w1;
        const multiNoise0 = (w0 - lp0 * 0.58) * 0.145;
        const multiNoise1 = (w1 - lp1 * 0.58) * 0.145;
        const shadowWave = Math.max(0, Math.sin(sec * Math.PI * 2 * 0.78) * 0.65 + Math.cos(sec * Math.PI * 2 * 1.35) * 0.55);
        const picketFlutter = 0.45 + 0.55 * Math.pow(Math.max(0, Math.sin(sec * Math.PI * 2 * 15.5 + Math.sin(sec * 3.2) * 1.8)), 2);
        const env = (0.28 + 0.92 * shadowWave) * picketFlutter;
        raw0[i] = multiNoise0 * env;
        raw1[i] = (multiNoise1 * 0.92 + multiNoise0 * 0.08) * env;
      } else if (mode === "storm") {
        // 磁暴雷雨：强电离层喘息底噪
        lp0 = 0.76 * lp0 + 0.24 * w0;
        lp1 = 0.76 * lp1 + 0.24 * w1;
        const stormNoise0 = (w0 - lp0 * 0.45) * 0.165;
        const stormNoise1 = (w1 - lp1 * 0.45) * 0.165;
        const surgeEnv = 0.75 + 0.25 * Math.sin(sec * Math.PI * 2 * 0.62) * Math.cos(sec * Math.PI * 2 * 0.29);
        const hum = Math.sin(i * hum100) * 0.0045;
        raw0[i] = stormNoise0 * surgeEnv + hum;
        raw1[i] = stormNoise1 * surgeEnv * 0.94 + stormNoise0 * 0.06 + hum;
      } else {
        // 默认 qrn：天电静电
        lp0 = 0.72 * lp0 + 0.28 * w0;
        lp1 = 0.72 * lp1 + 0.28 * w1;
        const bandNoise0 = (w0 - lp0 * 0.55) * 0.14;
        const bandNoise1 = (w1 - lp1 * 0.55) * 0.14;
        const qsbEnv = 0.82 + 0.18 * Math.sin(sec * Math.PI * 2 * 0.33);
        const whistleMod = Math.sin(sec * Math.PI * 2 * 0.42) * 18;
        const heterodyne =
          Math.sin(i * whistleA + whistleMod) * 0.0028 +
          Math.sin(i * whistleB - whistleMod * 0.7) * 0.0016;
        const tubeHum = Math.sin(i * hum100) * 0.0032;

        raw0[i] = bandNoise0 * qsbEnv + heterodyne + tubeHum;
        raw1[i] = (bandNoise1 * qsbEnv * 0.96 + bandNoise0 * 0.04) + heterodyne * 0.9 + tubeHum;
      }
    }

    // 注入不同干扰模式特有的瞬态脉冲簇 (雷电天电 / 障碍物遮挡反射刮擦 / 塔台 PTT 静噪咔哒)
    if (mode === "cockpit") {
      // 模拟航空/甚高频 PTT 静噪门开关尾音 (Squelch tail kerchunk)
      const squelchClicks = 4;
      for (let k = 0; k < squelchClicks; k++) {
        const pos = Math.floor(((k + 0.35) / squelchClicks) * length);
        const tailLen = Math.floor(sampleRate * 0.018);
        for (let j = 0; j < tailLen; j++) {
          const idx = (pos + j) % length;
          const env = Math.exp(-j / (tailLen * 0.28));
          const pop = ((j < 4 ? (j % 2 === 0 ? 1 : -1) * 0.22 : (Math.random() * 2 - 1) * 0.18)) * env;
          raw0[idx] += pop;
          raw1[idx] += pop * 0.92;
        }
      }
    } else if (mode === "obstacle") {
      // 模拟穿行隧道/高楼遮挡时的多径反射栅栏连发刮擦簇 (Picket-fence multipath burst clusters)
      const clusterCount = 5;
      for (let c = 0; c < clusterCount; c++) {
        const clusterStart = Math.floor(((c + 0.18) / clusterCount) * length);
        const pulses = 4 + (c % 3);
        const pulseStep = Math.floor(sampleRate * 0.055);
        const pulseLen = Math.floor(sampleRate * 0.028);
        for (let p = 0; p < pulses; p++) {
          const pos = (clusterStart + p * pulseStep) % length;
          const amp = 0.13 + 0.08 * Math.sin(((p + 1) / pulses) * Math.PI);
          for (let j = 0; j < pulseLen; j++) {
            const idx = (pos + j) % length;
            const win = Math.sin((j / pulseLen) * Math.PI);
            const chuff = (Math.random() * 2 - 1) * amp * win;
            raw0[idx] += chuff;
            raw1[idx] += chuff * 0.86;
          }
        }
      }
    } else {
      const density = mode === "storm" ? 6.5 : mode === "qrm" ? 1.2 : 2.2;
      const burstCount = Math.max(3, Math.floor((length / sampleRate) * density));
      for (let b = 0; b < burstCount; b++) {
        const startPos = Math.floor(Math.random() * length);
        const maxDur = mode === "storm" ? 0.048 : 0.022;
        const burstLen = Math.floor(sampleRate * (0.006 + Math.random() * maxDur));
        const amp = (mode === "storm" ? 0.14 : 0.09) + Math.random() * (mode === "storm" ? 0.24 : 0.16);
        for (let j = 0; j < burstLen; j++) {
          const idx = (startPos + j) % length;
          const win = Math.sin((j / burstLen) * Math.PI);
          const crack = (Math.random() * 2 - 1) * amp * win;
          raw0[idx] += crack;
          raw1[idx] += crack * 0.88;
        }
      }
    }

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
   * 六大无线电调频波段声学参数表：
   * - sw: 短波 (3–30MHz 电离层天波反射、300Hz–3.5kHz 电木窄带与慢速 QSB 衰落)
   * - lw: 长波 (148–283kHz 远距地波广播、保留 130Hz 温暖低频与 2.6kHz 柔和暗调滚降)
   * - fm: 调频 (87.5–108MHz 经典电子管调频广播、92Hz–10.5kHz 宽频温暖去加重与立体声导频切频)
   * - vhf: 甚高频 (30–300MHz 超短波对讲通讯、3.1kHz 预加重清脆高频与 6kHz 宽通带)
   * - air: 航空 (118–137MHz VHF AM 塔台/机舱话音、420Hz–2.9kHz 紧致窄带与面罩麦克风高频咬字峰)
   * - marine: 航海 (2182kHz/Ch.16 海事单边带 SSB、防风号角喇叭中频共鸣与海浪多径频偏漂移)
   */
  const RADIO_BAND_PROFILES = {
    sw: {
      id: "sw",
      shortLabel: "短波 SW",
      label: "短波广播 (SW 3–30MHz 天波窄带)",
      hp1: 280,
      hp1Q: 0.85,
      hp2: 360,
      hp2Q: 0.95,
      boxFreq: 1120,
      boxQ: 1.65,
      boxGain: 4.6,
      presFreq: 2100,
      presQ: 1.85,
      presGain: 3.4,
      lp1: 3250,
      lp1Q: 1.2,
      lp2: 3600,
      lp2Q: 1.1,
      driveBase: 1.05,
      driveScale: 0.65,
      makeup: 1.92,
      qsbRate: 0.23,
      qsbDepth: 0.08,
      driftRate: 0.13,
      driftDepth: 240,
    },
    lw: {
      id: "lw",
      shortLabel: "长波 LW",
      label: "长波电台 (LW 148–283kHz 地波暖声)",
      hp1: 120,
      hp1Q: 0.75,
      hp2: 165,
      hp2Q: 0.85,
      boxFreq: 440,
      boxQ: 1.35,
      boxGain: 4.0,
      presFreq: 1280,
      presQ: 1.5,
      presGain: 2.8,
      lp1: 2400,
      lp1Q: 1.25,
      lp2: 2750,
      lp2Q: 1.15,
      driveBase: 0.98,
      driveScale: 0.55,
      makeup: 1.78,
      qsbRate: 0.11,
      qsbDepth: 0.035,
      driftRate: 0.07,
      driftDepth: 95,
    },
    fm: {
      id: "fm",
      shortLabel: "调频 FM",
      label: "调频广播 (FM 87.5–108MHz 胆机宽频)",
      hp1: 88,
      hp1Q: 0.72,
      hp2: 125,
      hp2Q: 0.78,
      boxFreq: 240,
      boxQ: 1.15,
      boxGain: 2.6,
      presFreq: 3600,
      presQ: 1.3,
      presGain: 2.8,
      lp1: 9200,
      lp1Q: 0.85,
      lp2: 11200,
      lp2Q: 0.8,
      driveBase: 0.82,
      driveScale: 0.35,
      makeup: 1.38,
      qsbRate: 0.28,
      qsbDepth: 0.015,
      driftRate: 0.08,
      driftDepth: 45,
    },
    vhf: {
      id: "vhf",
      shortLabel: "甚高频 VHF",
      label: "甚高频通讯 (VHF 30–300MHz 预加重通带)",
      hp1: 155,
      hp1Q: 0.75,
      hp2: 215,
      hp2Q: 0.8,
      boxFreq: 780,
      boxQ: 1.2,
      boxGain: 2.0,
      presFreq: 3100,
      presQ: 1.55,
      presGain: 4.2,
      lp1: 5600,
      lp1Q: 0.95,
      lp2: 6400,
      lp2Q: 0.9,
      driveBase: 0.9,
      driveScale: 0.45,
      makeup: 1.48,
      qsbRate: 0.35,
      qsbDepth: 0.02,
      driftRate: 0.09,
      driftDepth: 55,
    },
    air: {
      id: "air",
      shortLabel: "航空 AIR",
      label: "航空塔台 (AIR 118–137MHz 机舱 AM 窄带)",
      hp1: 390,
      hp1Q: 1.0,
      hp2: 495,
      hp2Q: 1.1,
      boxFreq: 1380,
      boxQ: 1.9,
      boxGain: 5.2,
      presFreq: 2350,
      presQ: 2.1,
      presGain: 4.8,
      lp1: 2780,
      lp1Q: 1.45,
      lp2: 3080,
      lp2Q: 1.35,
      driveBase: 1.2,
      driveScale: 0.75,
      makeup: 2.12,
      qsbRate: 0.42,
      qsbDepth: 0.03,
      driftRate: 0.18,
      driftDepth: 110,
    },
    marine: {
      id: "marine",
      shortLabel: "航海 SEA",
      label: "航海通讯 (SEA 2182kHz/Ch.16 海事单边带)",
      hp1: 315,
      hp1Q: 0.9,
      hp2: 410,
      hp2Q: 1.0,
      boxFreq: 940,
      boxQ: 1.8,
      boxGain: 4.5,
      presFreq: 1860,
      presQ: 1.9,
      presGain: 3.9,
      lp1: 2880,
      lp1Q: 1.3,
      lp2: 3250,
      lp2Q: 1.2,
      driveBase: 1.12,
      driveScale: 0.68,
      makeup: 1.98,
      qsbRate: 0.18,
      qsbDepth: 0.11,
      driftRate: 0.16,
      driftDepth: 320,
    },
  };

  /**
   * 六种无线电波干扰与底噪模式：
   * - qrn: 天电静电 (大气静电嘶声与电离层脉冲)
   * - qrm: 邻频哨叫 (外差载波差拍哨音与远距 CW 莫尔斯电报音)
   * - obstacle: 障碍物干扰 (山体/隧道/高楼遮挡：多径瑞利栅栏扑哧猝发簇 + 遮挡瞬间信号高频收缩与电平下陷)
   * - storm: 磁暴雷雨 (密集雷暴静电簇与深幅磁暴起伏)
   * - cockpit: 塔台底噪 (VHF 静噪嘶声、400Hz 机载航电交流音与 PTT 静噪咔哒)
   * - clean: 纯净无噪 (关闭背景噪声源，仅保留所选波段频响与检波音色)
   */
  const RADIO_NOISE_PROFILES = {
    qrn: {
      id: "qrn",
      shortLabel: "天电静电",
      label: "天电静电 (QRN 大气电离层底噪)",
      gainScale: 1.0,
      bpFreq: 1480,
      bpQ: 0.75,
      lpFreq: 3300,
    },
    qrm: {
      id: "qrm",
      shortLabel: "邻频哨叫",
      label: "邻频哨叫 (QRM 差拍啸叫与远距电报)",
      gainScale: 1.08,
      bpFreq: 1620,
      bpQ: 0.95,
      lpFreq: 3400,
    },
    obstacle: {
      id: "obstacle",
      shortLabel: "障碍遮挡",
      label: "障碍物干扰 (隧道/山体遮挡与多径栅栏衰落)",
      gainScale: 1.22,
      bpFreq: 1760,
      bpQ: 0.72,
      lpFreq: 4200,
    },
    storm: {
      id: "storm",
      shortLabel: "磁暴雷雨",
      label: "磁暴雷雨 (强雷电静电脉冲与湍流)",
      gainScale: 1.35,
      bpFreq: 1320,
      bpQ: 0.6,
      lpFreq: 3800,
    },
    cockpit: {
      id: "cockpit",
      shortLabel: "塔台底噪",
      label: "塔台底噪 (VHF 静噪尾音与 400Hz 航电声)",
      gainScale: 0.95,
      bpFreq: 2150,
      bpQ: 0.8,
      lpFreq: 4800,
    },
    clean: {
      id: "clean",
      shortLabel: "纯净无噪",
      label: "纯净无噪 (仅保留波段滤波与电子管检波)",
      gainScale: 0,
      bpFreq: 1480,
      bpQ: 0.75,
      lpFreq: 3300,
    },
  };

  /**
   * 沙龙环境背景音声景配置表（面向“智能融乐伴奏”声学调校）：
   * - off: 关闭环境声景
   * - rain: 雨天 (窗外隔窗暖雨、轻风摇曳与外侧屋檐木质雨滴)
   * - thunder: 雷暴 (远山夜雨、柔和低风与深沉遥远滚雷，无突兀炸响)
   * - wild: 野外声 (松林柔和微风、远溪潺潺与立体声边缘轻柔虫鸟)
   * - city: 城市声 (深夜雨街远景空气垫与无音高湿滑车流掠过，100% 不与任何调性音乐冲突)
   * - fireplace: 壁炉声 (维多利亚壁炉暖火呼吸气流与外缘柔和松木轻啪)
   */
  const AMBIENT_PROFILES = {
    off: {
      id: "off",
      shortLabel: "未开启",
      label: "已关闭环境背景音",
      gainScale: 0,
      hpFreq: 100,
      scoopFreq: 1350,
      scoopQ: 0.6,
      scoopGain: -7.0,
      lpFreq: 2400,
    },
    rain: {
      id: "rain",
      shortLabel: "雨天 · 窗外暖雨",
      label: "雨天声景 · 窗外绵密暖雨与柔和屋檐雨滴",
      gainScale: 1.12,
      hpFreq: 165,
      scoopFreq: 1350,
      scoopQ: 0.6,
      scoopGain: -7.5,
      lpFreq: 2450,
    },
    thunder: {
      id: "thunder",
      shortLabel: "雷暴 · 远山夜雨",
      label: "雷暴声景 · 窗外夜雨与遥远低沉滚雷",
      gainScale: 0.96,
      hpFreq: 48,
      scoopFreq: 1250,
      scoopQ: 0.58,
      scoopGain: -8.0,
      lpFreq: 2100,
    },
    wild: {
      id: "wild",
      shortLabel: "野外声 · 远林微风",
      label: "野外声景 · 远林微风、溪流与轻柔虫鸟",
      gainScale: 0.86,
      hpFreq: 185,
      scoopFreq: 1450,
      scoopQ: 0.62,
      scoopGain: -7.0,
      lpFreq: 3200,
    },
    city: {
      id: "city",
      shortLabel: "城市声 · 夜街远景",
      label: "城市声景 · 深夜雨街远景与湿滑车流微响",
      gainScale: 0.90,
      hpFreq: 78,
      scoopFreq: 1200,
      scoopQ: 0.58,
      scoopGain: -7.5,
      lpFreq: 1650,
    },
    fireplace: {
      id: "fireplace",
      shortLabel: "壁炉声 · 暖炉柴火",
      label: "壁炉声景 · 维多利亚壁炉暖火与松木轻啪",
      gainScale: 0.94,
      hpFreq: 85,
      scoopFreq: 1300,
      scoopQ: 0.6,
      scoopGain: -7.5,
      lpFreq: 2650,
    },
  };

  /**
   * 按指定声景模式生成 16 秒无缝立体声环境背景音缓冲（首尾等功率余弦交叉淡化 + 统一 RMS 归一化与软峰限制）：
   * - 所有离散声学细节均放置在立体声外缘并经过温润阻尼处理，把正中声场留给人声与主旋律；
   * - 16 秒长循环显著削弱机械重复感，并统一归一化至 TARGET_AMBIENT_BUFFER_RMS 确保切换声景时响度平滑一致。
   */
  function createAmbientBuffer(ctx, ambientMode) {
    const mode = ambientMode || "rain";
    const sampleRate = ctx.sampleRate;
    const durationSec = 16;
    const length = Math.max(sampleRate * 4, Math.floor(sampleRate * durationSec));
    const fadeLen = Math.min(Math.floor(sampleRate * 0.08), Math.floor(length / 8));
    const totalGen = length + fadeLen;
    const raw0 = new Float32Array(totalGen);
    const raw1 = new Float32Array(totalGen);

    let b0_0 = 0, b1_0 = 0, b2_0 = 0;
    let b0_1 = 0, b1_1 = 0, b2_1 = 0;
    let patLp0 = 0, patLp1 = 0;
    let gustLp = 0;
    let leafLp0 = 0, leafLp1 = 0;

    for (let w = 0; w < 2048; w++) {
      const n0 = Math.random() * 2 - 1;
      const n1 = Math.random() * 2 - 1;
      b0_0 = 0.992 * b0_0 + n0 * 0.055;
      b1_0 = 0.955 * b1_0 + n0 * 0.082;
      b2_0 = 0.84 * b2_0 + n0 * 0.145;
      b0_1 = 0.992 * b0_1 + n1 * 0.055;
      b1_1 = 0.955 * b1_1 + n1 * 0.082;
      b2_1 = 0.84 * b2_1 + n1 * 0.145;
    }

    function brookRipple(t) {
      return 0.8 + 0.2 * Math.sin(t * Math.PI * 2 * 2.5 + Math.sin(t * 5.2));
    }

    for (let i = 0; i < totalGen; i++) {
      const w0 = Math.random() * 2 - 1;
      const w1 = Math.random() * 2 - 1;
      const sec = i / sampleRate;

      b0_0 = 0.992 * b0_0 + w0 * 0.055;
      b1_0 = 0.955 * b1_0 + w0 * 0.082;
      b2_0 = 0.84 * b2_0 + w0 * 0.145;
      const pink0 = (b0_0 + b1_0 + b2_0) * 0.082;

      b0_1 = 0.992 * b0_1 + w1 * 0.055;
      b1_1 = 0.955 * b1_1 + w1 * 0.082;
      b2_1 = 0.84 * b2_1 + w1 * 0.145;
      const pink1 = (b0_1 + b1_1 + b2_1) * 0.082;

      if (mode === "rain" || mode === "thunder") {
        const isThunder = mode === "thunder";
        const swayL = 0.86 + 0.14 * Math.sin(sec * Math.PI * 2 * 0.125 + 0.4);
        const swayR = 0.86 + 0.14 * Math.cos(sec * Math.PI * 2 * 0.1875);
        // 丝绒低通雨丝基底，彻底消除白噪沙哑刺耳感
        patLp0 = 0.72 * patLp0 + 0.28 * w0;
        patLp1 = 0.72 * patLp1 + 0.28 * w1;
        const patter0 = patLp0 * (isThunder ? 0.042 : 0.032);
        const patter1 = patLp1 * (isThunder ? 0.042 : 0.032);
        let gustSwell = 0;
        if (isThunder) {
          gustLp = 0.97 * gustLp + 0.03 * b0_0;
          gustSwell = gustLp * 0.24 * (0.65 + 0.35 * Math.sin(sec * Math.PI * 2 * 0.1875));
        }
        raw0[i] = (pink0 * (isThunder ? 1.02 : 0.92) + patter0) * swayL + gustSwell;
        raw1[i] = (pink1 * (isThunder ? 1.02 : 0.92) + patter1) * swayR + gustSwell * 0.88;
      } else if (mode === "wild") {
        // 柔和松林微风与远溪潺潺
        const breezeL = 0.72 + 0.28 * Math.sin(sec * Math.PI * 2 * 0.125) * Math.cos(sec * Math.PI * 2 * 0.1875);
        const breezeR = 0.72 + 0.28 * Math.cos(sec * Math.PI * 2 * 0.125 + 0.5) * Math.sin(sec * Math.PI * 2 * 0.1875 + 0.7);
        leafLp0 = 0.78 * leafLp0 + 0.22 * (b1_0 * 0.65 + b2_0 * 0.35);
        leafLp1 = 0.78 * leafLp1 + 0.22 * (b1_1 * 0.65 + b2_1 * 0.35);
        const leaves0 = leafLp0 * 0.26 * breezeL;
        const leaves1 = leafLp1 * 0.26 * breezeR;
        const brook0 = b1_0 * 0.042 * brookRipple(sec);
        const brook1 = b1_1 * 0.042 * brookRipple(sec + 0.23);
        raw0[i] = leaves0 + brook0;
        raw1[i] = leaves1 + brook1;
      } else if (mode === "city") {
        // 深夜城市远景空气垫（纯无音高宽频底噪，绝不产生任何嗡鸣或调性冲突）
        const citySwell = 0.88 + 0.12 * Math.sin(sec * Math.PI * 2 * 0.125);
        raw0[i] = (b0_0 * 0.088 + b1_0 * 0.032) * citySwell;
        raw1[i] = (b0_1 * 0.088 + b1_1 * 0.032) * citySwell;
      } else if (mode === "fireplace") {
        // 维多利亚壁炉暖火气流与柔和炭火呼吸
        const draftL = 0.82 + 0.18 * Math.sin(sec * Math.PI * 2 * 0.125 + 0.3) * Math.cos(sec * Math.PI * 2 * 0.1875);
        const draftR = 0.82 + 0.18 * Math.cos(sec * Math.PI * 2 * 0.125) * Math.sin(sec * Math.PI * 2 * 0.1875 + 0.6);
        raw0[i] = (b0_0 * 0.092 + b1_0 * 0.042) * draftL;
        raw1[i] = (b0_1 * 0.092 + b1_1 * 0.042) * draftR;
      }
    }

    // 叠加克制、远离中央人声区（声像置于外侧）的柔和环境纹理事件
    if (mode === "rain" || mode === "thunder") {
      const dropCount = Math.floor((length / sampleRate) * (mode === "thunder" ? 10 : 7));
      for (let d = 0; d < dropCount; d++) {
        const startPos = Math.floor(Math.random() * length);
        const dropLen = Math.max(8, Math.floor(sampleRate * (0.005 + Math.random() * 0.006)));
        const freq = 540 + Math.random() * 680;
        // 刻意避开中央声场，放置在左右窗框外缘
        const pan = Math.random() < 0.5 ? (0.08 + Math.random() * 0.18) : (0.74 + Math.random() * 0.18);
        const amp = (0.012 + Math.random() * 0.018) * (mode === "thunder" ? 1.1 : 1.0);
        const panL = Math.cos(pan * Math.PI * 0.5);
        const panR = Math.sin(pan * Math.PI * 0.5);
        const attackLen = Math.max(1, dropLen * 0.15);
        for (let j = 0; j < dropLen; j++) {
          const idx = (startPos + j) % length;
          const t = j / sampleRate;
          const env = Math.exp(-j / (dropLen * 0.22)) * Math.sin(Math.min(1, j / attackLen) * Math.PI * 0.5);
          const tap = (Math.sin(2 * Math.PI * freq * t) * 0.5 + (Math.random() * 2 - 1) * 0.45) * amp * env;
          raw0[idx] += tap * panL;
          raw1[idx] += tap * panR;
        }
      }
    }

    if (mode === "thunder") {
      // 16 秒内仅安排 2 场低沉遥远的谷地滚雷（双阶深低通，彻底去除突兀炸裂感）
      const strikes = [
        { posRatio: 0.16, durSec: 4.4, pan: 0.24, strength: 0.14 },
        { posRatio: 0.64, durSec: 3.8, pan: 0.76, strength: 0.1 },
      ];
      strikes.forEach((st) => {
        const startPos = Math.floor(st.posRatio * length);
        const thunderLen = Math.min(length - 1, Math.floor(sampleRate * st.durSec));
        let lpA0 = 0, lpB0 = 0;
        let lpA1 = 0, lpB1 = 0;
        const panL = Math.cos(st.pan * Math.PI * 0.5);
        const panR = Math.sin(st.pan * Math.PI * 0.5);
        for (let j = 0; j < thunderLen; j++) {
          const idx = (startPos + j) % length;
          const normT = j / thunderLen;
          const secT = j / sampleRate;
          const rollEnv =
            Math.sin(Math.min(1, normT * 2.8) * Math.PI * 0.5) *
            Math.exp(-normT * 2.3) *
            (0.68 + 0.32 * Math.sin(secT * Math.PI * 2 * 1.4 + Math.cos(secT * 2.9)));
          lpA0 = 0.986 * lpA0 + 0.014 * (Math.random() * 2 - 1);
          lpB0 = 0.978 * lpB0 + 0.022 * lpA0;
          lpA1 = 0.986 * lpA1 + 0.014 * (Math.random() * 2 - 1);
          lpB1 = 0.978 * lpB1 + 0.022 * lpA1;
          const wave0 = Math.tanh(lpB0 * 18.0 * rollEnv * 1.3) * st.strength;
          const wave1 = Math.tanh(lpB1 * 18.0 * rollEnv * 1.3) * st.strength;
          raw0[idx] += wave0 * panL;
          raw1[idx] += wave1 * panR;
        }
      });
    } else if (mode === "wild") {
      // 1) 遥远轻柔的林缘晚虫微鸣（低电平、外缘声像、柔滑起落包络）
      const cricketBursts = 10;
      for (let c = 0; c < cricketBursts; c++) {
        const basePos = Math.floor(((c + 0.3) / cricketBursts) * length);
        const pan = c % 2 === 0 ? 0.1 : 0.9;
        const panL = Math.cos(pan * Math.PI * 0.5);
        const panR = Math.sin(pan * Math.PI * 0.5);
        const carrier = Math.min(sampleRate * 0.42, c % 2 === 0 ? 3420 : 3680);
        const pulseGap = Math.floor(sampleRate * 0.044);
        const pulseDur = Math.max(8, Math.floor(sampleRate * 0.026));
        for (let p = 0; p < 3; p++) {
          const pStart = (basePos + p * pulseGap) % length;
          for (let j = 0; j < pulseDur; j++) {
            const idx = (pStart + j) % length;
            const win = Math.pow(Math.sin((j / pulseDur) * Math.PI), 1.5);
            const sig = Math.sin((2 * Math.PI * carrier * j) / sampleRate) * 0.0075 * win;
            raw0[idx] += sig * panL;
            raw1[idx] += sig * panR;
          }
        }
      }
      // 2) 16 秒内仅 3 声远处花园林鸟轻啭（克制弱化，绝不盖过歌曲旋律）
      const birdCalls = [
        { ratio: 0.14, fStart: 2050, fEnd: 2480, dur: 0.15, pan: 0.14 },
        { ratio: 0.49, fStart: 2320, fEnd: 1980, dur: 0.17, pan: 0.86 },
        { ratio: 0.81, fStart: 1880, fEnd: 2240, dur: 0.14, pan: 0.18 },
      ];
      birdCalls.forEach((bc) => {
        const startPos = Math.floor(bc.ratio * length);
        const callLen = Math.max(16, Math.floor(sampleRate * bc.dur));
        const panL = Math.cos(bc.pan * Math.PI * 0.5);
        const panR = Math.sin(bc.pan * Math.PI * 0.5);
        let phase = 0;
        for (let j = 0; j < callLen; j++) {
          const idx = (startPos + j) % length;
          const prog = j / callLen;
          const env = Math.pow(Math.sin(prog * Math.PI), 1.6) * Math.pow(1 - prog * 0.25, 1.2);
          const trill = Math.sin(prog * Math.PI * 2 * 12) * 32;
          const instFreq = Math.min(sampleRate * 0.42, bc.fStart + (bc.fEnd - bc.fStart) * prog + trill);
          phase += (2 * Math.PI * instFreq) / sampleRate;
          const birdSample = Math.sin(phase) * 0.013 * env;
          raw0[idx] += birdSample * panL;
          raw1[idx] += birdSample * panR;
        }
      });
    } else if (mode === "city") {
      // 16 秒内 3 趟远街湿滑路面宽频车流掠过（纯宽频滤噪，去除单音发动机与冲突钟铃）
      const passes = [
        { ratio: 0.1, dur: 3.2, leftToRight: true },
        { ratio: 0.46, dur: 3.6, leftToRight: false },
        { ratio: 0.78, dur: 2.9, leftToRight: true },
      ];
      passes.forEach((ps) => {
        const startPos = Math.floor(ps.ratio * length);
        const passLen = Math.min(length - 1, Math.floor(sampleRate * ps.dur));
        let lpCarA = 0;
        let lpCarB = 0;
        for (let j = 0; j < passLen; j++) {
          const idx = (startPos + j) % length;
          const prog = j / passLen;
          const env = Math.pow(Math.sin(prog * Math.PI), 2.0);
          const pan = ps.leftToRight ? (0.12 + 0.76 * prog) : (0.88 - 0.76 * prog);
          lpCarA = 0.9 * lpCarA + 0.1 * (Math.random() * 2 - 1);
          lpCarB = 0.86 * lpCarB + 0.14 * lpCarA;
          const tire = lpCarB * 0.145 * env;
          raw0[idx] += tire * Math.cos(pan * Math.PI * 0.5);
          raw1[idx] += tire * Math.sin(pan * Math.PI * 0.5);
        }
      });
    } else if (mode === "fireplace") {
      // 16 秒内 22 声置于立体声外缘的柔和松木轻啪与炭火微爆
      const popCount = 22;
      for (let c = 0; c < popCount; c++) {
        const startPos = Math.floor(Math.random() * length);
        const popLen = Math.max(10, Math.floor(sampleRate * (0.004 + Math.random() * 0.007)));
        const freq = 420 + Math.random() * 1030;
        const pan = Math.random() < 0.5 ? (0.10 + Math.random() * 0.18) : (0.72 + Math.random() * 0.18);
        const panL = Math.cos(pan * Math.PI * 0.5);
        const panR = Math.sin(pan * Math.PI * 0.5);
        const amp = 0.016 + Math.random() * 0.022;
        const attackLen = Math.max(1, popLen * 0.12);
        for (let j = 0; j < popLen; j++) {
          const idx = (startPos + j) % length;
          const t = j / sampleRate;
          const env = Math.exp(-j / (popLen * 0.24)) * Math.sin(Math.min(1, j / attackLen) * Math.PI * 0.5);
          const crackle = (Math.sin(2 * Math.PI * freq * t) * 0.55 + (Math.random() * 2 - 1) * 0.45) * amp * env;
          raw0[idx] += crackle * panL;
          raw1[idx] += crackle * panR;
        }
      }
    }

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

    // 统一能量归一化 + 柔和软峰压限，确保四大声景响度基线一致且绝无突兀尖峰
    let sumSq = 0;
    for (let i = 0; i < length; i++) {
      sumSq += ch0[i] * ch0[i] + ch1[i] * ch1[i];
    }
    const rms = Math.sqrt(sumSq / (2 * length));
    if (rms > 1e-6) {
      const norm = TARGET_AMBIENT_BUFFER_RMS / rms;
      for (let i = 0; i < length; i++) {
        ch0[i] = Math.tanh(ch0[i] * norm * 1.4) / 1.4;
        ch1[i] = Math.tanh(ch1[i] * norm * 1.4) / 1.4;
      }
    }

    return buffer;
  }

  /**
   * 模拟矿石/二极管包络检波器非对称削波与电子管五极管交调失真曲线（严格零点无偏置）。
   */
  function makeRadioDistortionCurve() {
    const n = 4096;
    const curve = new Float32Array(n);
    const rawEval = (x) => {
      const asym = x >= 0 ? Math.tanh(x * 2.55) * 0.98 : Math.tanh(x * 1.9) * 0.84;
      const grit = 0.08 * x * x - 0.045 * x * x * x;
      return asym + grit;
    };
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
    const radioBtn = options.radioBtn;
    const toast = options.toast;

    let vinylFxEnabled = storageGet(KEYS.VINYL_FX, "0") === "1";
    let synthFxEnabled = storageGet(KEYS.SYNTH_FX, "0") === "1";
    let radioFxEnabled = storageGet(KEYS.RADIO_FX, "0") === "1";

    const savedEq = safeParseJson(storageGet(KEYS.EQ, ""), {});
    const eqState = {
      preamp: clampNum(savedEq.preamp, -6, 12, 3),
      bass: clampNum(savedEq.bass, -12, 12, 0),
      mid: clampNum(savedEq.mid, -12, 12, 0),
      treble: clampNum(savedEq.treble, -12, 12, 0),
    };

    const savedMix = safeParseJson(storageGet(KEYS.FX_MIX, ""), {});
    const mixState = {
      vinyl: clampNum(savedMix.vinyl, 0.2, 1.5, 1.0),
      synth: clampNum(savedMix.synth, 0.2, 1.5, 1.0),
      radio: clampNum(savedMix.radio, 0.2, 1.5, 1.0),
    };

    const savedRadioTuning = safeParseJson(storageGet(KEYS.RADIO_TUNING, ""), {});
    const radioTuning = {
      band: Object.hasOwn(RADIO_BAND_PROFILES, savedRadioTuning.band) ? savedRadioTuning.band : "sw",
      noiseMode: Object.hasOwn(RADIO_NOISE_PROFILES, savedRadioTuning.noiseMode) ? savedRadioTuning.noiseMode : "qrn",
      noiseLevel: clampNum(savedRadioTuning.noiseLevel, 0, 2.0, 1.0),
    };

    const savedAmbient = safeParseJson(storageGet(KEYS.AMBIENT, ""), {});
    const ambientState = {
      mode: Object.hasOwn(AMBIENT_PROFILES, savedAmbient.mode) ? savedAmbient.mode : "off",
      level: clampNum(savedAmbient.level, 0.1, 2.0, 1.0),
    };

    let audioCtx = null;
    let baseGraph = null;
    let synthNodes = null;
    let vinylNodes = null;
    let radioNodes = null;
    let ambientNodes = null;
    let eqNodes = null;
    let analyserNode = null;
    let musicDuckAnalyser = null;
    let duckFloatBuf = null;
    let duckByteBuf = null;
    let vinylNoiseBuffer = null;
    const radioNoiseBuffers = {};
    const ambientBuffers = {};

    let synthConnected = false;
    let vinylConnected = false;
    let radioConnected = false;
    let ambientConnected = false;
    let ambientDuckConnected = false;
    let eqConnected = false;
    let analyserWanted = false;
    let analyserConnected = false;
    let synthDisconnectTimer = null;
    let vinylDisconnectTimer = null;
    let radioDisconnectTimer = null;
    let ambientDisconnectTimer = null;
    let ambientDuckTimer = null;
    let eqDisconnectTimer = null;
    let audioSuspendTimer = null;

    let ambientSmoothRms = 0.055;
    let ambientDuckWarmupTicks = 0;
    let ambientAdaptiveGain = 0.55;

    let sleepFadeFactor = 1;
    let transitionFadeFactor = 1;
    let volumeBoost = 1;
    let fadeOutRestoreTimer = null;
    let fallbackFadeInterval = null;
    let fadeInUntilMs = 0;

    function clearTransitionTimers() {
      clearTimeout(fadeOutRestoreTimer);
      fadeOutRestoreTimer = null;
      clearInterval(fallbackFadeInterval);
      fallbackFadeInterval = null;
    }

    function isEqActive() {
      return Math.abs(eqState.bass) >= 0.05 || Math.abs(eqState.mid) >= 0.05 || Math.abs(eqState.treble) >= 0.05;
    }

    function isAmbientActive() {
      return ambientState.mode !== "off" && Object.hasOwn(AMBIENT_PROFILES, ambientState.mode);
    }

    function isPreampOrBoostActive() {
      return Math.abs(eqState.preamp) >= 0.05 || volumeBoost > 1.005;
    }

    function getPreampLinear() {
      return Math.pow(10, clampNum(eqState.preamp, -6, 12, 0) / 20) * Math.max(0.5, Math.min(2, volumeBoost));
    }

    function needsAudioGraph() {
      return !!(
        vinylFxEnabled ||
        synthFxEnabled ||
        radioFxEnabled ||
        isAmbientActive() ||
        isEqActive() ||
        isPreampOrBoostActive() ||
        analyserWanted
      );
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

        // 第三级总线(第二级输出 vs 短波/调幅无线电台)
        const stage3DryGain = audioCtx.createGain();
        stage3DryGain.gain.value = 1;
        const postStage3Bus = audioCtx.createGain();
        postStage3Bus.gain.value = 1;
        postStage2Bus.connect(stage3DryGain);
        stage3DryGain.connect(postStage3Bus);

        // EQ 旁路直通增益、主响度前级增益与软削峰防破音限制器
        const eqDryGain = audioCtx.createGain();
        eqDryGain.gain.value = 1;
        const masterGain = audioCtx.createGain();
        masterGain.gain.value = getPreampLinear();
        const masterLimiter = audioCtx.createDynamicsCompressor();
        masterLimiter.threshold.value = -1.0;
        masterLimiter.knee.value = 6;
        masterLimiter.ratio.value = 14;
        masterLimiter.attack.value = 0.002;
        masterLimiter.release.value = 0.09;

        postStage3Bus.connect(eqDryGain);
        eqDryGain.connect(masterGain);
        masterGain.connect(masterLimiter);
        masterLimiter.connect(audioCtx.destination);

        baseGraph = {
          source,
          stage1DryGain,
          stage1Bus,
          stage2DryGain,
          postStage2Bus,
          stage3DryGain,
          postStage3Bus,
          eqDryGain,
          masterGain,
          masterLimiter,
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
        inputTrim.gain.value = 1.05;

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
        makeupGain.gain.value = 1.42;

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

    function resetGainParamImmediate(param, val) {
      if (!param) return;
      if (audioCtx && typeof param.cancelScheduledValues === "function") {
        const t = audioCtx.currentTime;
        param.cancelScheduledValues(t);
        if (typeof param.setValueAtTime === "function") {
          param.setValueAtTime(val, t);
          return;
        }
      }
      param.value = val;
    }

    function disconnectSynthBranchImmediate() {
      if (!synthNodes || !synthConnected) return;
      safeDisconnect(baseGraph.source, synthNodes.inputTrim);
      safeDisconnect(synthNodes.wetGain, baseGraph.stage1Bus);
      synthNodes.lfos.forEach(safeStopSource);
      synthNodes.lfos = [];
      synthConnected = false;
      if (baseGraph && baseGraph.stage1DryGain) {
        resetGainParamImmediate(baseGraph.stage1DryGain.gain, 1);
      }
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
        warmShelf.gain.value = 2.6;

        const midRes = audioCtx.createBiquadFilter();
        midRes.type = "peaking";
        midRes.frequency.value = 2200;
        midRes.gain.value = 2.0;
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
      if (baseGraph && baseGraph.stage2DryGain) {
        resetGainParamImmediate(baseGraph.stage2DryGain.gain, 1);
      }
    }

    function scheduleVinylDisconnect() {
      clearTimeout(vinylDisconnectTimer);
      if (!vinylConnected) return;
      vinylDisconnectTimer = setTimeout(() => {
        vinylDisconnectTimer = null;
        if (!vinylFxEnabled) disconnectVinylBranchImmediate();
      }, BYPASS_DISCONNECT_DELAY_MS);
    }

    function buildRadioNodes() {
      if (radioNodes) return true;
      if (!ensureBaseGraph()) return false;
      try {
        const inputDrive = audioCtx.createGain();
        inputDrive.gain.value = 1.65;

        // 二阶陡峭高通 (切除 320Hz 以下低频，模拟矿石/电木小口径喇叭同时保留中低频饱满度)
        const hp1 = audioCtx.createBiquadFilter();
        hp1.type = "highpass";
        hp1.frequency.value = 280;
        hp1.Q.value = 0.85;

        const hp2 = audioCtx.createBiquadFilter();
        hp2.type = "highpass";
        hp2.frequency.value = 360;
        hp2.Q.value = 0.95;

        // 电木箱体中频腔体鼻音共振与调幅话音峰
        const boxRes = audioCtx.createBiquadFilter();
        boxRes.type = "peaking";
        boxRes.frequency.value = 1120;
        boxRes.Q.value = 1.65;
        boxRes.gain.value = 4.6;

        const presencePeak = audioCtx.createBiquadFilter();
        presencePeak.type = "peaking";
        presencePeak.frequency.value = 2100;
        presencePeak.Q.value = 1.85;
        presencePeak.gain.value = 3.4;

        // 二极管包络检波与电子管五极管过载削波
        const shaper = audioCtx.createWaveShaper();
        shaper.curve = makeRadioDistortionCurve();
        shaper.oversample = "2x";

        // 二阶陡峭调幅中频低通墙 (3.2kHz–3.6kHz 截频，受电离层漂移微调)
        const lp1 = audioCtx.createBiquadFilter();
        lp1.type = "lowpass";
        lp1.frequency.value = 3250;
        lp1.Q.value = 1.2;

        const lp2 = audioCtx.createBiquadFilter();
        lp2.type = "lowpass";
        lp2.frequency.value = 3600;
        lp2.Q.value = 1.1;

        const driftGain = audioCtx.createGain();
        driftGain.gain.value = 260;
        driftGain.connect(lp1.frequency);

        // 短波自动增益控制 (AGC) 压缩感、补偿增益与电离层天波衰落 (QSB)
        const agcComp = audioCtx.createDynamicsCompressor();
        agcComp.threshold.value = -18;
        agcComp.knee.value = 10;
        agcComp.ratio.value = 3.6;
        agcComp.attack.value = 0.005;
        agcComp.release.value = 0.14;

        const fadeModGain = audioCtx.createGain();
        fadeModGain.gain.value = 1.92;

        const fadeLfoGain = audioCtx.createGain();
        fadeLfoGain.gain.value = 0.08;
        fadeLfoGain.connect(fadeModGain.gain);

        const wetGain = audioCtx.createGain();
        wetGain.gain.value = 0;

        inputDrive.connect(hp1);
        hp1.connect(hp2);
        hp2.connect(boxRes);
        boxRes.connect(presencePeak);
        presencePeak.connect(shaper);
        shaper.connect(lp1);
        lp1.connect(lp2);
        lp2.connect(agcComp);
        agcComp.connect(fadeModGain);
        fadeModGain.connect(wetGain);

        // 短波静电与外差哨叫噪声支路
        const noiseBp = audioCtx.createBiquadFilter();
        noiseBp.type = "bandpass";
        noiseBp.frequency.value = 1480;
        noiseBp.Q.value = 0.75;

        const noiseLp = audioCtx.createBiquadFilter();
        noiseLp.type = "lowpass";
        noiseLp.frequency.value = 3300;

        const noiseGain = audioCtx.createGain();
        noiseGain.gain.value = 0;

        noiseBp.connect(noiseLp);
        noiseLp.connect(noiseGain);

        radioNodes = {
          inputDrive,
          hp1,
          hp2,
          boxRes,
          presencePeak,
          lp1,
          lp2,
          agcComp,
          fadeModGain,
          wetGain,
          driftGain,
          fadeLfoGain,
          noiseBp,
          noiseLp,
          noiseGain,
          noiseSource: null,
          activeNoiseMode: "",
          fadeLfo: null,
          driftLfo: null,
          lfos: [],
        };
        return true;
      } catch (e) {
        console.warn("Radio audio emulation unavailable:", e);
        return false;
      }
    }

    function getRadioNoiseBuffer(mode) {
      const m = Object.hasOwn(RADIO_NOISE_PROFILES, mode) ? mode : "qrn";
      if (m === "clean") return null;
      if (!radioNoiseBuffers[m]) {
        radioNoiseBuffers[m] = createRadioStaticBuffer(audioCtx, m);
      }
      return radioNoiseBuffers[m];
    }

    function syncRadioNoiseSource() {
      if (!radioNodes || !radioConnected || !audioCtx) return;
      const mode = radioTuning.noiseMode;
      if (radioNodes.activeNoiseMode === mode && (mode === "clean" || radioNodes.noiseSource)) return;
      safeStopSource(radioNodes.noiseSource);
      radioNodes.noiseSource = null;
      radioNodes.activeNoiseMode = mode;
      if (mode === "clean") return;
      const buf = getRadioNoiseBuffer(mode);
      if (!buf) return;
      const noiseSource = audioCtx.createBufferSource();
      noiseSource.buffer = buf;
      noiseSource.loop = true;
      noiseSource.connect(radioNodes.noiseBp);
      noiseSource.start();
      radioNodes.noiseSource = noiseSource;
    }

    function connectRadioBranch() {
      clearTimeout(radioDisconnectTimer);
      radioDisconnectTimer = null;
      if (!buildRadioNodes()) return false;
      if (!radioConnected) {
        const bp = RADIO_BAND_PROFILES[radioTuning.band] || RADIO_BAND_PROFILES.sw;
        baseGraph.postStage2Bus.connect(radioNodes.inputDrive);
        radioNodes.wetGain.connect(baseGraph.postStage3Bus);
        radioNodes.noiseGain.connect(baseGraph.postStage3Bus);

        const fadeLfo = audioCtx.createOscillator();
        fadeLfo.type = "sine";
        fadeLfo.frequency.value = bp.qsbRate;
        fadeLfo.connect(radioNodes.fadeLfoGain);

        const driftLfo = audioCtx.createOscillator();
        driftLfo.type = "sine";
        driftLfo.frequency.value = bp.driftRate;
        driftLfo.connect(radioNodes.driftGain);

        fadeLfo.start();
        driftLfo.start();

        radioNodes.fadeLfo = fadeLfo;
        radioNodes.driftLfo = driftLfo;
        radioNodes.lfos = [fadeLfo, driftLfo];
        radioConnected = true;
        syncRadioNoiseSource();
      }
      return true;
    }

    function disconnectRadioBranchImmediate() {
      if (!radioNodes || !radioConnected) return;
      safeDisconnect(baseGraph.postStage2Bus, radioNodes.inputDrive);
      safeDisconnect(radioNodes.wetGain, baseGraph.postStage3Bus);
      safeDisconnect(radioNodes.noiseGain, baseGraph.postStage3Bus);
      safeStopSource(radioNodes.noiseSource);
      radioNodes.lfos.forEach(safeStopSource);
      radioNodes.noiseSource = null;
      radioNodes.activeNoiseMode = "";
      radioNodes.fadeLfo = null;
      radioNodes.driftLfo = null;
      radioNodes.lfos = [];
      radioConnected = false;
      if (baseGraph && baseGraph.stage3DryGain) {
        resetGainParamImmediate(baseGraph.stage3DryGain.gain, 1);
      }
    }

    function scheduleRadioDisconnect() {
      clearTimeout(radioDisconnectTimer);
      if (!radioConnected) return;
      radioDisconnectTimer = setTimeout(() => {
        radioDisconnectTimer = null;
        if (!radioFxEnabled) disconnectRadioBranchImmediate();
      }, BYPASS_DISCONNECT_DELAY_MS);
    }

    function buildAmbientNodes() {
      if (ambientNodes) return true;
      if (!ensureBaseGraph()) return false;
      try {
        const sourceFadeGain = audioCtx.createGain();
        sourceFadeGain.gain.value = 1;

        // 1) 次低频清理高通，避免与音乐底鼓/大提琴混浊碰撞
        const hp = audioCtx.createBiquadFilter();
        hp.type = "highpass";
        hp.frequency.value = 165;
        hp.Q.value = 0.707;

        // 2) 人声与主旋律专属声场让位凹槽 (1.2kHz–1.45kHz 宽带 -7dB 退让)
        const midScoop = audioCtx.createBiquadFilter();
        midScoop.type = "peaking";
        midScoop.frequency.value = 1350;
        midScoop.Q.value = 0.6;
        midScoop.gain.value = -7.5;

        // 3) 双阶 24dB/oct 隔窗空气吸收低通，去除刺耳沙哑白噪高频
        const lp1 = audioCtx.createBiquadFilter();
        lp1.type = "lowpass";
        lp1.frequency.value = 2450;
        lp1.Q.value = 0.62;

        const lp2 = audioCtx.createBiquadFilter();
        lp2.type = "lowpass";
        lp2.frequency.value = 2800;
        lp2.Q.value = 0.62;

        // 4) 柔膝动态尖峰驯服器，杜绝雨滴/滚雷/鸟鸣瞬间冒头打断音乐
        const bedComp = audioCtx.createDynamicsCompressor();
        bedComp.threshold.value = -24;
        bedComp.knee.value = 16;
        bedComp.ratio.value = 3.2;
        bedComp.attack.value = 0.015;
        bedComp.release.value = 0.28;

        // 5) 音乐响度自适应耦合增益 + 用户总控淡入淡出增益
        const duckGain = audioCtx.createGain();
        duckGain.gain.value = ambientAdaptiveGain;

        const outGain = audioCtx.createGain();
        outGain.gain.value = 0;

        sourceFadeGain.connect(hp);
        hp.connect(midScoop);
        midScoop.connect(lp1);
        lp1.connect(lp2);

        let spatialActive = false;
        if (
          typeof audioCtx.createDelay === "function" &&
          typeof audioCtx.createChannelSplitter === "function" &&
          typeof audioCtx.createChannelMerger === "function"
        ) {
          // 隔窗空间远景反射扩散 (19ms/29ms 交叉暗反射) + Mid-Side 立体声环绕退让 (Mid -2.8dB / Side +1.7dB，单声道完全兼容)
          const spatialSum = audioCtx.createGain();
          spatialSum.gain.value = 1;

          const directGain = audioCtx.createGain();
          directGain.gain.value = 0.72;
          lp2.connect(directGain);
          directGain.connect(spatialSum);

          const diffSplit = audioCtx.createChannelSplitter(2);
          const delayL = audioCtx.createDelay(0.08);
          delayL.delayTime.value = 0.019;
          const delayR = audioCtx.createDelay(0.08);
          delayR.delayTime.value = 0.029;
          const diffMerge = audioCtx.createChannelMerger(2);
          const diffLp = audioCtx.createBiquadFilter();
          diffLp.type = "lowpass";
          diffLp.frequency.value = 1450;
          diffLp.Q.value = 0.707;
          const diffWetGain = audioCtx.createGain();
          diffWetGain.gain.value = 0.34;

          lp2.connect(diffSplit);
          diffSplit.connect(delayL, 0);
          diffSplit.connect(delayR, 1);
          delayL.connect(diffMerge, 0, 1);
          delayR.connect(diffMerge, 0, 0);
          diffMerge.connect(diffLp);
          diffLp.connect(diffWetGain);
          diffWetGain.connect(spatialSum);

          // Mid-Side 退让矩阵：L' = 0.97*L - 0.25*R, R' = 0.97*R - 0.25*L (把中心让给主唱/乐器，外侧柔和环绕)
          const msSplit = audioCtx.createChannelSplitter(2);
          const msMerge = audioCtx.createChannelMerger(2);
          const lToL = audioCtx.createGain();
          lToL.gain.value = 0.97;
          const rToL = audioCtx.createGain();
          rToL.gain.value = -0.25;
          const rToR = audioCtx.createGain();
          rToR.gain.value = 0.97;
          const lToR = audioCtx.createGain();
          lToR.gain.value = -0.25;

          spatialSum.connect(msSplit);
          msSplit.connect(lToL, 0);
          msSplit.connect(lToR, 0);
          msSplit.connect(rToR, 1);
          msSplit.connect(rToL, 1);
          lToL.connect(msMerge, 0, 0);
          rToL.connect(msMerge, 0, 0);
          rToR.connect(msMerge, 0, 1);
          lToR.connect(msMerge, 0, 1);
          msMerge.connect(bedComp);
          spatialActive = true;
        } else {
          lp2.connect(bedComp);
        }

        bedComp.connect(duckGain);
        duckGain.connect(outGain);

        ambientNodes = {
          sourceFadeGain,
          hp,
          midScoop,
          lp1,
          lp2,
          bedComp,
          duckGain,
          outGain,
          spatialActive,
          source: null,
          activeMode: "",
        };
        return true;
      } catch (e) {
        console.warn("Ambient soundscape emulation unavailable:", e);
        return false;
      }
    }

    function sampleAmbientMusicCoupling() {
      if (!ambientNodes || !ambientConnected || !musicDuckAnalyser || !audioCtx || audio.paused || audio.muted || audio.volume <= 0) return;
      let sumSq = 0;
      let count = 0;
      if (typeof musicDuckAnalyser.getFloatTimeDomainData === "function") {
        if (!duckFloatBuf || duckFloatBuf.length !== musicDuckAnalyser.fftSize) {
          duckFloatBuf = new Float32Array(musicDuckAnalyser.fftSize);
        }
        musicDuckAnalyser.getFloatTimeDomainData(duckFloatBuf);
        count = duckFloatBuf.length;
        for (let i = 0; i < count; i++) {
          const s = duckFloatBuf[i];
          sumSq += s * s;
        }
      } else if (typeof musicDuckAnalyser.getByteTimeDomainData === "function") {
        if (!duckByteBuf || duckByteBuf.length !== musicDuckAnalyser.fftSize) {
          duckByteBuf = new Uint8Array(musicDuckAnalyser.fftSize);
        }
        musicDuckAnalyser.getByteTimeDomainData(duckByteBuf);
        count = duckByteBuf.length;
        for (let i = 0; i < count; i++) {
          const s = (duckByteBuf[i] - 128) / 128;
          sumSq += s * s;
        }
      }

      const rawRms = count > 0 ? Math.sqrt(sumSq / count) : 0;
      let targetGain = 0.55;
      if (rawRms >= 1e-6) {
        const effVol = Math.max(0.08, Math.min(1, Number(audio.volume) || 0));
        const trackRms = Math.min(0.65, rawRms / effVol);
        const fastWarmup = ambientDuckWarmupTicks < 5;
        ambientDuckWarmupTicks += 1;
        const alpha = fastWarmup ? 0.36 : (trackRms > ambientSmoothRms ? 0.14 : 0.075);
        ambientSmoothRms = ambientSmoothRms * (1 - alpha) + trackRms * alpha;
        // 音乐响度比例耦合：无论极轻钢琴 (-38dBFS) 还是饱满爵士/军乐 (-16dBFS)，背景音始终温和稳居音乐之下约 17–20dB
        const couple = clampNum(0.02 + Math.pow(ambientSmoothRms, 0.9) * 7.6, 0.15, 1.62);
        // 强音/主唱瞬态温和退让 (约 -1.5 至 -2.5dB)，无抽吸感
        const peakDuck = 1 / (1 + Math.max(0, trackRms - ambientSmoothRms * 1.12) * 3.2);
        targetGain = clampNum(couple * peakDuck, 0.14, 1.55);
      }

      ambientAdaptiveGain = targetGain;
      const t = audioCtx.currentTime;
      ambientNodes.duckGain.gain.setTargetAtTime(targetGain, t, 0.32);
    }

    function startAmbientDuckLoop() {
      if (!ambientConnected || !isAmbientActive() || audio.paused || !baseGraph || !audioCtx) return;
      if (!musicDuckAnalyser && typeof audioCtx.createAnalyser === "function") {
        musicDuckAnalyser = audioCtx.createAnalyser();
        musicDuckAnalyser.fftSize = 256;
        musicDuckAnalyser.smoothingTimeConstant = 0.85;
      }
      if (musicDuckAnalyser && !ambientDuckConnected) {
        baseGraph.postStage3Bus.connect(musicDuckAnalyser);
        ambientDuckConnected = true;
      }
      if (!ambientDuckTimer && musicDuckAnalyser) {
        sampleAmbientMusicCoupling();
        ambientDuckTimer = setInterval(sampleAmbientMusicCoupling, 120);
      }
    }

    function stopAmbientDuckLoop() {
      if (ambientDuckTimer) {
        clearInterval(ambientDuckTimer);
        ambientDuckTimer = null;
      }
      if (ambientDuckConnected && baseGraph && musicDuckAnalyser) {
        safeDisconnect(baseGraph.postStage3Bus, musicDuckAnalyser);
        ambientDuckConnected = false;
      }
    }

    function getAmbientBuffer(mode) {
      if (!Object.hasOwn(AMBIENT_PROFILES, mode) || mode === "off") return null;
      if (!ambientBuffers[mode]) {
        ambientBuffers[mode] = createAmbientBuffer(audioCtx, mode);
      }
      return ambientBuffers[mode];
    }

    function syncAmbientSource() {
      if (!ambientNodes || !ambientConnected || !audioCtx) return;
      const mode = ambientState.mode;
      if (ambientNodes.activeMode === mode && (!isAmbientActive() || ambientNodes.source)) return;
      const hadPrev = !!ambientNodes.source;
      safeStopSource(ambientNodes.source);
      ambientNodes.source = null;
      ambientNodes.activeMode = mode;
      if (!isAmbientActive()) return;
      const buf = getAmbientBuffer(mode);
      if (!buf) return;
      const src = audioCtx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      src.connect(ambientNodes.sourceFadeGain);
      if (hadPrev && ambientNodes.sourceFadeGain) {
        const t = audioCtx.currentTime;
        ambientNodes.sourceFadeGain.gain.cancelScheduledValues(t);
        ambientNodes.sourceFadeGain.gain.setValueAtTime(0.001, t);
        ambientNodes.sourceFadeGain.gain.setTargetAtTime(1, t + 0.01, 0.08);
      }
      src.start();
      ambientNodes.source = src;
    }

    function connectAmbientBranch() {
      clearTimeout(ambientDisconnectTimer);
      ambientDisconnectTimer = null;
      if (!buildAmbientNodes()) return false;
      if (!ambientConnected) {
        ambientNodes.outGain.connect(baseGraph.masterGain);
        ambientConnected = true;
        ambientDuckWarmupTicks = 0;
      }
      syncAmbientSource();
      startAmbientDuckLoop();
      return true;
    }

    function disconnectAmbientBranchImmediate() {
      stopAmbientDuckLoop();
      if (!ambientNodes || !ambientConnected) return;
      safeDisconnect(ambientNodes.outGain, baseGraph.masterGain);
      safeStopSource(ambientNodes.source);
      ambientNodes.source = null;
      ambientNodes.activeMode = "";
      ambientConnected = false;
    }

    function scheduleAmbientDisconnect() {
      clearTimeout(ambientDisconnectTimer);
      if (!ambientConnected) return;
      ambientDisconnectTimer = setTimeout(() => {
        ambientDisconnectTimer = null;
        if (!isAmbientActive()) disconnectAmbientBranchImmediate();
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

    function disconnectEqBranchImmediate() {
      if (!eqNodes || !eqConnected || !baseGraph) return;
      safeDisconnect(baseGraph.postStage3Bus, eqNodes.low);
      safeDisconnect(eqNodes.wetGain, baseGraph.masterGain);
      eqConnected = false;
      if (baseGraph.eqDryGain) {
        resetGainParamImmediate(baseGraph.eqDryGain.gain, 1);
      }
    }

    function scheduleEqDisconnect() {
      clearTimeout(eqDisconnectTimer);
      if (!eqConnected) return;
      eqDisconnectTimer = setTimeout(() => {
        eqDisconnectTimer = null;
        if (!isEqActive()) disconnectEqBranchImmediate();
      }, BYPASS_DISCONNECT_DELAY_MS);
    }

    function syncEqBranch() {
      const wantEq = isEqActive();
      if (wantEq && !audio.paused) {
        clearTimeout(eqDisconnectTimer);
        eqDisconnectTimer = null;
        if (buildEqNodes() && !eqConnected) {
          baseGraph.postStage3Bus.connect(eqNodes.low);
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
        if (!wantEq && eqConnected) scheduleEqDisconnect();
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
      if (!vinylFxEnabled || audio.paused || audio.muted || audio.volume <= 0) return 0;
      const baseVol = typeof options.getBaseVolume === "function" ? options.getBaseVolume() : audio.volume;
      return BASE_VINYL_NOISE_GAIN * Math.min(1, Math.max(0, baseVol)) * mixState.vinyl;
    }

    function getTargetRadioNoiseGain() {
      if (!radioFxEnabled || audio.paused || audio.muted || audio.volume <= 0) return 0;
      const np = RADIO_NOISE_PROFILES[radioTuning.noiseMode] || RADIO_NOISE_PROFILES.qrn;
      if (!np.gainScale || radioTuning.noiseLevel <= 0) return 0;
      const baseVol = typeof options.getBaseVolume === "function" ? options.getBaseVolume() : audio.volume;
      return BASE_RADIO_STATIC_GAIN * Math.min(1, Math.max(0, baseVol)) * mixState.radio * radioTuning.noiseLevel * np.gainScale;
    }

    function getTargetAmbientGain() {
      if (!isAmbientActive() || audio.paused || audio.muted || audio.volume <= 0) return 0;
      const ap = AMBIENT_PROFILES[ambientState.mode] || AMBIENT_PROFILES.off;
      if (!ap.gainScale || ambientState.level <= 0) return 0;
      const baseVol = typeof options.getBaseVolume === "function" ? options.getBaseVolume() : audio.volume;
      const levelCurve = Math.pow(Math.max(0, ambientState.level), 1.3);
      return BASE_AMBIENT_GAIN * Math.min(1, Math.max(0, baseVol)) * levelCurve * ap.gainScale;
    }

    function applyMasterFade(immediate) {
      if (!immediate && Date.now() < fadeInUntilMs) return;
      const fadeTarget = Math.max(0.015, Math.min(1, sleepFadeFactor * transitionFadeFactor));
      if (baseGraph && audioCtx) {
        const time = audioCtx.currentTime;
        const target = Math.max(0.015, Math.min(4.5, fadeTarget * getPreampLinear()));
        const gainParam = baseGraph.masterGain.gain;
        if (typeof gainParam.cancelAndHoldAtTime === "function") {
          try { gainParam.cancelAndHoldAtTime(time); } catch (e) { gainParam.cancelScheduledValues(time); }
        } else if (typeof gainParam.cancelScheduledValues === "function") {
          gainParam.cancelScheduledValues(time);
        }
        gainParam.setTargetAtTime(target, time, immediate ? 0.008 : 0.035);
      } else if (typeof options.onFallbackGainChange === "function") {
        options.onFallbackGainChange(fadeTarget);
      }
    }

    function updateGraph(immediate) {
      if (!audio.paused && needsAudioGraph()) ensureBaseGraph();
      if (synthFxEnabled && !audio.paused) connectSynthBranch();
      if (vinylFxEnabled && !audio.paused) connectVinylBranch();
      if (radioFxEnabled && !audio.paused) connectRadioBranch();
      if (isAmbientActive() && !audio.paused) connectAmbientBranch();
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
      const synthDry = useSynth ? Math.max(0, 1 - sMix * 0.8) : 1;
      const synthWet = useSynth ? Math.min(1.45, 0.35 + 0.85 * sMix) : 0;
      baseGraph.stage1DryGain.gain.setTargetAtTime(synthDry, time, rampTime);
      if (synthNodes) {
        synthNodes.wetGain.gain.setTargetAtTime(synthWet, time, rampTime);
        if (!synthFxEnabled && synthConnected) scheduleSynthDisconnect();
      }

      const useVinyl = !!(vinylFxEnabled && vinylConnected && vinylNodes);
      baseGraph.stage2DryGain.gain.setTargetAtTime(useVinyl ? 0 : 1, time, rampTime);
      if (vinylNodes) {
        vinylNodes.wetGain.gain.setTargetAtTime(useVinyl ? 1.22 : 0, time, rampTime);
        vinylNodes.noiseGain.gain.setTargetAtTime(getTargetNoiseGain(), time, rampTime);
        vinylNodes.wowGain.gain.setTargetAtTime(0.00028 * mixState.vinyl, time, rampTime);
        vinylNodes.flutterGain.gain.setTargetAtTime(0.00006 * mixState.vinyl, time, rampTime);
        if (!vinylFxEnabled && vinylConnected) scheduleVinylDisconnect();
      }

      const useRadio = !!(radioFxEnabled && radioConnected && radioNodes);
      const rMix = Math.max(0.2, Math.min(1.5, mixState.radio));
      const radioDry = useRadio ? Math.max(0, (1 - rMix) * 0.72) : 1;
      const radioWet = useRadio ? Math.min(1.38, 0.85 + 0.35 * rMix) : 0;
      baseGraph.stage3DryGain.gain.setTargetAtTime(radioDry, time, rampTime);
      if (radioNodes) {
        if (useRadio) syncRadioNoiseSource();
        const bp = RADIO_BAND_PROFILES[radioTuning.band] || RADIO_BAND_PROFILES.sw;
        const np = RADIO_NOISE_PROFILES[radioTuning.noiseMode] || RADIO_NOISE_PROFILES.qrn;
        const isObstacle = radioTuning.noiseMode === "obstacle";
        const obstacleFactor = isObstacle ? Math.max(0.35, Math.min(1.6, radioTuning.noiseLevel)) : 0;
        const effLp1 = isObstacle ? Math.max(1500, bp.lp1 * (1 - 0.16 * obstacleFactor)) : bp.lp1;
        const effLp2 = isObstacle ? Math.max(1850, bp.lp2 * (1 - 0.14 * obstacleFactor)) : bp.lp2;
        const effQsbRate = isObstacle ? 1.18 : bp.qsbRate;
        const effQsbDepth = isObstacle
          ? Math.min(0.34, (bp.qsbDepth + 0.17 * obstacleFactor) * Math.min(1.3, rMix))
          : bp.qsbDepth * Math.min(1.25, rMix);
        const effDriftRate = isObstacle ? 0.84 : bp.driftRate;
        const effDriftDepth = isObstacle
          ? Math.max(bp.driftDepth, 460 * obstacleFactor) * rMix
          : bp.driftDepth * rMix;

        radioNodes.wetGain.gain.setTargetAtTime(radioWet, time, rampTime);
        radioNodes.inputDrive.gain.setTargetAtTime(bp.driveBase + bp.driveScale * rMix, time, rampTime);
        radioNodes.hp1.frequency.setTargetAtTime(bp.hp1, time, rampTime);
        radioNodes.hp1.Q.setTargetAtTime(bp.hp1Q, time, rampTime);
        radioNodes.hp2.frequency.setTargetAtTime(bp.hp2, time, rampTime);
        radioNodes.hp2.Q.setTargetAtTime(bp.hp2Q, time, rampTime);
        radioNodes.boxRes.frequency.setTargetAtTime(bp.boxFreq, time, rampTime);
        radioNodes.boxRes.Q.setTargetAtTime(bp.boxQ, time, rampTime);
        radioNodes.boxRes.gain.setTargetAtTime(bp.boxGain, time, rampTime);
        radioNodes.presencePeak.frequency.setTargetAtTime(bp.presFreq, time, rampTime);
        radioNodes.presencePeak.Q.setTargetAtTime(bp.presQ, time, rampTime);
        radioNodes.presencePeak.gain.setTargetAtTime(bp.presGain, time, rampTime);
        radioNodes.lp1.frequency.setTargetAtTime(effLp1, time, rampTime);
        radioNodes.lp1.Q.setTargetAtTime(bp.lp1Q, time, rampTime);
        radioNodes.lp2.frequency.setTargetAtTime(effLp2, time, rampTime);
        radioNodes.lp2.Q.setTargetAtTime(bp.lp2Q, time, rampTime);
        radioNodes.fadeModGain.gain.setTargetAtTime(bp.makeup, time, rampTime);
        radioNodes.fadeLfoGain.gain.setTargetAtTime(effQsbDepth, time, rampTime);
        radioNodes.driftGain.gain.setTargetAtTime(effDriftDepth, time, rampTime);
        if (radioNodes.fadeLfo) radioNodes.fadeLfo.frequency.setTargetAtTime(effQsbRate, time, rampTime);
        if (radioNodes.driftLfo) radioNodes.driftLfo.frequency.setTargetAtTime(effDriftRate, time, rampTime);
        radioNodes.noiseBp.frequency.setTargetAtTime(np.bpFreq, time, rampTime);
        radioNodes.noiseBp.Q.setTargetAtTime(np.bpQ, time, rampTime);
        radioNodes.noiseLp.frequency.setTargetAtTime(np.lpFreq, time, rampTime);
        radioNodes.noiseGain.gain.setTargetAtTime(getTargetRadioNoiseGain(), time, rampTime);
        if (!radioFxEnabled && radioConnected) scheduleRadioDisconnect();
      }

      if (ambientNodes) {
        if (isAmbientActive() && ambientConnected) {
          syncAmbientSource();
          if (!audio.paused) startAmbientDuckLoop();
          else stopAmbientDuckLoop();
        } else {
          stopAmbientDuckLoop();
        }
        const ap = AMBIENT_PROFILES[ambientState.mode] || AMBIENT_PROFILES.off;
        const nyq = Math.max(1200, (audioCtx.sampleRate || 44100) * 0.45);
        const targetAmb = getTargetAmbientGain();
        const ambRamp = immediate ? 0.008 : (targetAmb > 0 ? 0.16 : 0.04);
        ambientNodes.hp.frequency.setTargetAtTime(Math.min(nyq, ap.hpFreq), time, rampTime);
        ambientNodes.midScoop.frequency.setTargetAtTime(Math.min(nyq, ap.scoopFreq || 1350), time, rampTime);
        ambientNodes.midScoop.Q.setTargetAtTime(ap.scoopQ || 0.6, time, rampTime);
        ambientNodes.midScoop.gain.setTargetAtTime(ap.scoopGain != null ? ap.scoopGain : -7.5, time, rampTime);
        ambientNodes.lp1.frequency.setTargetAtTime(Math.min(nyq, ap.lpFreq), time, rampTime);
        ambientNodes.lp2.frequency.setTargetAtTime(Math.min(nyq, ap.lpFreq * 1.15), time, rampTime);
        ambientNodes.outGain.gain.setTargetAtTime(targetAmb, time, ambRamp);
        if (!isAmbientActive() && ambientConnected) scheduleAmbientDisconnect();
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
      setPressedButtonState(radioBtn, radioFxEnabled);
      document.body.classList.toggle("radio-fx-active", radioFxEnabled);
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

    function toggleRadioFx() {
      radioFxEnabled = !radioFxEnabled;
      storageSet(KEYS.RADIO_FX, radioFxEnabled ? "1" : "0");
      if (!audio.paused) {
        if (radioFxEnabled) connectRadioBranch();
        ensureResumed();
        updateGraph(false);
      } else if (!radioFxEnabled && radioConnected) {
        updateGraph(true);
      }
      syncUI();
      if (toast) {
        const bp = RADIO_BAND_PROFILES[radioTuning.band] || RADIO_BAND_PROFILES.sw;
        const np = RADIO_NOISE_PROFILES[radioTuning.noiseMode] || RADIO_NOISE_PROFILES.qrn;
        toast(
          radioFxEnabled
            ? "已开启无线电台模式 · " + bp.shortLabel + " / " + np.shortLabel
            : "已关闭无线电台模式 · 还原宽频原声"
        );
      }
    }

    function persistRadioTuning() {
      storageSet(KEYS.RADIO_TUNING, JSON.stringify(radioTuning));
    }

    function setRadioBand(bandId, showToast) {
      if (!Object.hasOwn(RADIO_BAND_PROFILES, bandId)) return getRadioTuning();
      radioTuning.band = bandId;
      persistRadioTuning();
      if (!radioFxEnabled && showToast) {
        radioFxEnabled = true;
        storageSet(KEYS.RADIO_FX, "1");
        syncUI();
      }
      if (!audio.paused && radioFxEnabled) {
        connectRadioBranch();
        ensureResumed();
      }
      updateGraph(false);
      if (showToast && toast) {
        toast("无线电调频：" + RADIO_BAND_PROFILES[bandId].label);
      }
      return getRadioTuning();
    }

    function setRadioNoiseMode(modeId, showToast) {
      if (!Object.hasOwn(RADIO_NOISE_PROFILES, modeId)) return getRadioTuning();
      radioTuning.noiseMode = modeId;
      persistRadioTuning();
      if (!radioFxEnabled && showToast) {
        radioFxEnabled = true;
        storageSet(KEYS.RADIO_FX, "1");
        syncUI();
      }
      if (!audio.paused && radioFxEnabled) {
        connectRadioBranch();
        syncRadioNoiseSource();
        ensureResumed();
      }
      updateGraph(false);
      if (showToast && toast) {
        toast("电波干扰模式：" + RADIO_NOISE_PROFILES[modeId].label);
      }
      return getRadioTuning();
    }

    function setRadioNoiseLevel(level) {
      radioTuning.noiseLevel = clampNum(level, 0, 2.0, 1.0);
      persistRadioTuning();
      updateGraph(false);
      return getRadioTuning();
    }

    function getRadioTuning() {
      const bp = RADIO_BAND_PROFILES[radioTuning.band] || RADIO_BAND_PROFILES.sw;
      const np = RADIO_NOISE_PROFILES[radioTuning.noiseMode] || RADIO_NOISE_PROFILES.qrn;
      return {
        band: radioTuning.band,
        bandLabel: bp.label,
        bandShortLabel: bp.shortLabel,
        noiseMode: radioTuning.noiseMode,
        noiseLabel: np.label,
        noiseShortLabel: np.shortLabel,
        noiseLevel: radioTuning.noiseLevel,
      };
    }

    function persistAmbientState() {
      storageSet(KEYS.AMBIENT, JSON.stringify(ambientState));
    }

    function setAmbientMode(modeId, showToast) {
      if (!Object.hasOwn(AMBIENT_PROFILES, modeId)) return getAmbientState();
      ambientState.mode = modeId;
      persistAmbientState();
      if (!audio.paused && isAmbientActive()) {
        connectAmbientBranch();
        ensureResumed();
      } else if (!isAmbientActive() && ambientConnected) {
        updateGraph(true);
      }
      updateGraph(false);
      if (showToast && toast) {
        toast(
          modeId === "off"
            ? "已关闭沙龙环境背景音"
            : "已开启环境背景音：" + AMBIENT_PROFILES[modeId].label
        );
      }
      return getAmbientState();
    }

    function setAmbientLevel(level) {
      ambientState.level = clampNum(level, 0.1, 2.0, 1.0);
      persistAmbientState();
      updateGraph(false);
      return getAmbientState();
    }

    function getAmbientState() {
      const ap = AMBIENT_PROFILES[ambientState.mode] || AMBIENT_PROFILES.off;
      return {
        mode: ambientState.mode,
        label: ap.label,
        shortLabel: ap.shortLabel,
        level: ambientState.level,
        active: isAmbientActive(),
      };
    }

    function setEqBand(band, db) {
      if (band === "preamp") {
        eqState.preamp = clampNum(db, -6, 12, 0);
        storageSet(KEYS.EQ, JSON.stringify(eqState));
        fadeInUntilMs = 0;
        if (!audio.paused && needsAudioGraph()) {
          ensureBaseGraph();
          ensureResumed();
        }
        updateGraph(false);
        return;
      }
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
      return {
        preamp: eqState.preamp,
        bass: eqState.bass,
        mid: eqState.mid,
        treble: eqState.treble,
        active: isEqActive(),
      };
    }

    function setVolumeBoost(mult, skipApply) {
      volumeBoost = clampNum(mult, 0.5, 2, 1);
      fadeInUntilMs = 0;
      if (!audio.paused && needsAudioGraph()) {
        ensureBaseGraph();
        ensureResumed();
      }
      if (!skipApply) applyMasterFade(false);
    }

    function setFxMix(kind, value) {
      if (kind !== "vinyl" && kind !== "synth" && kind !== "radio") return;
      mixState[kind] = clampNum(value, 0.2, 1.5, 1.0);
      storageSet(KEYS.FX_MIX, JSON.stringify(mixState));
      updateGraph(false);
    }

    function getFxMix() {
      return { vinyl: mixState.vinyl, synth: mixState.synth, radio: mixState.radio };
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
      clearTransitionTimers();
      fadeInUntilMs = 0;
      transitionFadeFactor = clampNum(factor, 0.02, 1, 1);
      applyMasterFade(!!immediate);
    }

    function fadeOutThenRun(durationMs, callback) {
      clearTransitionTimers();
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
      clearTransitionTimers();
      const ms = Math.max(0, Number(durationMs) || 0);
      if (ms <= 30) {
        fadeInUntilMs = 0;
        transitionFadeFactor = 1;
        applyMasterFade(true);
        return;
      }
      const startMs = Date.now();
      fadeInUntilMs = startMs + ms;
      transitionFadeFactor = 1;
      const target = Math.max(0.02, Math.min(4.5, sleepFadeFactor * getPreampLinear()));
      if (baseGraph && audioCtx) {
        const t = audioCtx.currentTime;
        baseGraph.masterGain.gain.cancelScheduledValues(t);
        baseGraph.masterGain.gain.setValueAtTime(0.05, t);
        baseGraph.masterGain.gain.linearRampToValueAtTime(target, t + ms / 1000);
      } else if (typeof options.onFallbackGainChange === "function") {
        transitionFadeFactor = 0.05;
        options.onFallbackGainChange(Math.max(0.02, Math.min(1, sleepFadeFactor * transitionFadeFactor)));
        fallbackFadeInterval = setInterval(() => {
          if (baseGraph && audioCtx) {
            clearTransitionTimers();
            transitionFadeFactor = 1;
            fadeInUntilMs = 0;
            applyMasterFade(false);
            return;
          }
          const ratio = Math.min(1, (Date.now() - startMs) / ms);
          const eased = 0.05 + 0.95 * (1 - (1 - ratio) * (1 - ratio));
          transitionFadeFactor = ratio >= 1 ? 1 : eased;
          options.onFallbackGainChange(Math.max(0.02, Math.min(1, sleepFadeFactor * transitionFadeFactor)));
          if (ratio >= 1) {
            clearTransitionTimers();
            fadeInUntilMs = 0;
          }
        }, 40);
      }
    }

    function onPlay() {
      ambientDuckWarmupTicks = 0;
      if (needsAudioGraph()) {
        ensureBaseGraph();
        if (synthFxEnabled) connectSynthBranch();
        if (vinylFxEnabled) connectVinylBranch();
        if (radioFxEnabled) connectRadioBranch();
        if (isAmbientActive()) connectAmbientBranch();
        ensureResumed();
      }
      updateGraph(false);
    }

    function onPlaying() {
      if (needsAudioGraph() || baseGraph) ensureResumed();
      updateGraph(false);
    }

    function onPauseOrEnd() {
      stopAmbientDuckLoop();
      updateGraph(false);
      scheduleSuspend();
    }

    return {
      EQ_PRESETS,
      RADIO_BAND_PROFILES,
      RADIO_NOISE_PROFILES,
      AMBIENT_PROFILES,
      isVinylEnabled: () => vinylFxEnabled,
      isSynthEnabled: () => synthFxEnabled,
      isRadioEnabled: () => radioFxEnabled,
      isAmbientActive,
      isSynthConnected: () => synthConnected,
      isVinylConnected: () => vinylConnected,
      isRadioConnected: () => radioConnected,
      isAmbientConnected: () => ambientConnected,
      isEqActive,
      isEqConnected: () => eqConnected,
      isAnalyserConnected: () => analyserConnected,
      getEqState,
      setEqBand,
      applyEqPreset,
      setVolumeBoost,
      getVolumeBoost: () => volumeBoost,
      getPreampLinear,
      getFxMix,
      setFxMix,
      getRadioTuning,
      setRadioBand,
      setRadioNoiseMode,
      setRadioNoiseLevel,
      getAmbientState,
      setAmbientMode,
      setAmbientLevel,
      getAmbientAdaptiveGain: () => ambientAdaptiveGain,
      isAmbientSpatialActive: () => !!(ambientNodes && ambientNodes.spatialActive),
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
      toggleRadioFx,
      onPlay,
      onPlaying,
      onPauseOrEnd,
    };
  }

  ns.createAudioFxController = createAudioFxController;
})(window);
