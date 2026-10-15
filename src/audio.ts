/** Tiny synthesized sound bank. No asset downloads or autoplay before deployment. */
export class GameAudio {
  private context?: AudioContext;
  private master?: GainNode;
  private volume = .6;

  unlock() {
    this.context ??= new AudioContext();
    this.master ??= this.context.createGain();
    this.master.gain.value = this.volume * .35;
    this.master.connect(this.context.destination);
    void this.context.resume();
  }

  setVolume(value: number) {
    this.volume = value / 100;
    if (this.master) this.master.gain.value = this.volume * .35;
  }

  private tone(from: number, to: number, duration: number, gain: number, type: OscillatorType = 'sine', delay = 0) {
    if (!this.context || !this.master) return;
    const start = this.context.currentTime + delay;
    const oscillator = this.context.createOscillator();
    const envelope = this.context.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(from, start);
    oscillator.frequency.exponentialRampToValueAtTime(to, start + duration);
    envelope.gain.setValueAtTime(gain, start);
    envelope.gain.exponentialRampToValueAtTime(.001, start + duration);
    oscillator.connect(envelope).connect(this.master);
    oscillator.start(start);
    oscillator.stop(start + duration);
  }

  shot(remote = false) {
    if (!this.context || !this.master) return;
    const duration = remote ? .065 : .12;
    const buffer = this.context.createBuffer(1, this.context.sampleRate * duration, this.context.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / data.length, 3);
    const noise = this.context.createBufferSource();
    const envelope = this.context.createGain();
    const filter = this.context.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = remote ? 950 : 3800;
    envelope.gain.value = remote ? .14 : .6;
    noise.buffer = buffer;
    noise.connect(filter).connect(envelope).connect(this.master);
    noise.start();
    this.tone(remote ? 90 : 160, 45, .1, remote ? .06 : .3, 'triangle');
  }

  hit(headshot = false) { this.tone(headshot ? 1300 : 900, 500, .075, .18, 'triangle'); }
  damage() { this.tone(110, 45, .18, .25, 'sine'); }
  jump() { this.tone(120, 200, .09, .045, 'triangle'); }
  reload() {
    this.tone(450, 190, .08, .09, 'square');
    this.tone(650, 230, .09, .08, 'square', .9);
  }
  kill() {
    this.tone(660, 660, .1, .12, 'triangle');
    this.tone(990, 1320, .2, .12, 'triangle', .08);
  }
}
