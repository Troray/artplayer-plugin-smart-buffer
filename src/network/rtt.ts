export class RTTDetector {
  private rttSamples: number[] = [];
  private maxSamples = 15;
  private ewmaRtt = 0;
  private ewmaAlpha = 0.3;

  public recordRTT(rttMs: number): void {
    const validRtt = Math.max(1, rttMs);
    this.rttSamples.push(validRtt);
    if (this.rttSamples.length > this.maxSamples) {
      this.rttSamples.shift();
    }

    if (this.ewmaRtt === 0) {
      this.ewmaRtt = validRtt;
    } else {
      this.ewmaRtt = this.ewmaAlpha * validRtt + (1 - this.ewmaAlpha) * this.ewmaRtt;
    }
  }

  public getRTT(): number {
    return Math.round(this.ewmaRtt);
  }

  public reset(): void {
    this.rttSamples = [];
    this.ewmaRtt = 0;
  }

  public static formatRTT(rttMs: number): string {
    if (!rttMs || rttMs <= 0) return '-- ms';
    return `${Math.round(rttMs)} ms`;
  }
}
