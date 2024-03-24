import {DataRate} from "../units/data-rate";
import {TimeDelta, Timestamp} from "../units";

export class LinkCapacityTracker {
  private capacityEstimateBps:f64 = 0.0;
  private lastLinkCapacityUpdate:Timestamp = U64.MIN_VALUE;
  private lastDelayBasedEstimate:DataRate = U64.MAX_VALUE;
  private trackingRate: TimeDelta = 0;

  constructor(trackingRate: i32) {
    this.trackingRate = trackingRate;
  }

  updateDelayBasedEstimate(atTime: Timestamp, delayBasedBitrate: DataRate): void {
    if(delayBasedBitrate < this.lastDelayBasedEstimate){
      this.capacityEstimateBps = Math.min(this.capacityEstimateBps, delayBasedBitrate);
      this.lastLinkCapacityUpdate = atTime;
    }
    this.lastDelayBasedEstimate = delayBasedBitrate;
  }
  onStartingRate(startRate: DataRate): void {
    if (this.lastLinkCapacityUpdate === U64.MAX_VALUE)
      this.capacityEstimateBps = <f64>startRate;
  }
  onRateUpdate(acknowledged:DataRate, target: DataRate, atTime: u64){
    if(!acknowledged){
      return;
    }
    const acknowledgedTarget:DataRate = Math.min(acknowledged, target);
    if(acknowledgedTarget > <u64>this.capacityEstimateBps){
      const delta:TimeDelta = atTime - this.lastLinkCapacityUpdate;
      const alpha:f64 = delta>0&&delta<f64.MAX_VALUE?Math.exp(-<f64>delta/<f64>this.trackingRate):0.0;
      this.capacityEstimateBps = alpha*this.capacityEstimateBps + (1-alpha)*<f64>acknowledgedTarget;
    }
    this.lastLinkCapacityUpdate = atTime;
  }

  onRttBackoff(backoffRate: DataRate, atTime: u64):void {
    this.capacityEstimateBps = Math.min(this.capacityEstimateBps, <f64>backoffRate);
    this.lastLinkCapacityUpdate = atTime;
  }
  estimate():DataRate{
    return <DataRate>this.capacityEstimateBps;
  }
}
