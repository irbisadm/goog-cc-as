import {DataRate} from "../../../units";
import {clamp} from "../../../rtc-base/numerics/clamp";

export class LinkCapacityEstimator {
  private estimateKbps:f64 = 0;
  private deviationKbps = 0.4;
  upperBond():DataRate{
    if(this.estimateKbps){
      return <u64>(this.estimateKbps + 3 * this.deviationEstimateKbps());
    }
    return U64.MAX_VALUE;
  }

  lowerBond():DataRate{
    if(this.estimateKbps){
      return <u64>(this.estimateKbps - 3 * this.deviationEstimateKbps());
    }
    return 0;
  }

  reset():void{
    this.estimateKbps = 0;
  }

  onOveruseDetected(acknowledgedRate:DataRate):void{
    this.update(acknowledgedRate, 0.05)
  }
  onProbeRate(probeRate:DataRate):void{
    this.update(probeRate, 0.5)
  }

  private update(capacitySample:DataRate, alpha:f64):void{
    const sampleKbps = <f64>capacitySample;
    if(!this.estimateKbps){
      this.estimateKbps = sampleKbps;
    } else {
      this.estimateKbps = (1-alpha) * this.estimateKbps + alpha * sampleKbps;
    }
    // Estimate the variance of the link capacity estimate and normalize the
    // variance with the link capacity estimate.
    const norm:f64 = Math.max(this.estimateKbps, 1.0);
    const errorKbps:f64 = this.estimateKbps - sampleKbps;
    this.deviationKbps = (1- alpha) * this.deviationKbps + alpha * errorKbps * errorKbps / norm;
    // 0.4 ~= 14 kbit/s at 500 kbit/s
    // 2.5f ~= 35 kbit/s at 500 kbit/s
    this.deviationKbps = clamp(this.deviationKbps, 0.4, 2.5);
  }

  hasEstimate():bool {
    return this.estimateKbps > 0;
  }

  estimate():DataRate {
    return <u64>this.estimateKbps;
  }

  private deviationEstimateKbps():f64 {
    // Calculate the max bit rate std dev given the normalized
    // variance and the current throughput bitrate. The standard deviation will
    // only be used if estimate_kbps_ has a value.
    return Math.sqrt(this.deviationKbps * this.estimateKbps);
  }
}
