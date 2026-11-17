// One accepted gesture = one lane. Queued inputs cannot stretch an animation
// into a two-lane jump, even when fingers or arrow keys arrive very quickly.
(() => {
  'use strict';
  class LaneSteering {
    constructor({ laneCount = 4, seconds = .085, onMove = () => {} } = {}) {
      this.laneCount = laneCount;
      this.seconds = seconds;
      this.onMove = onMove;
      this.reset(2);
    }

    reset(lane = 2) {
      this.display = lane;
      this.from = lane;
      this.target = lane;
      this.elapsed = this.seconds;
      this.duration = this.seconds;
      this.previousLane = lane;
      this.queue = [];
    }

    request(direction) {
      if (direction !== -1 && direction !== 1) return false;
      const moving = this.elapsed < this.duration;
      if (moving && direction === -Math.sign(this.target - this.display)) {
        // Reverse immediately from the actual on-screen position. An old
        // queued tap must not force the car to finish its previous change.
        const abandoned = this.target;
        const returnTo = this.previousLane;
        this.queue.length = 0;
        this.from = this.display;
        this.target = returnTo;
        this.previousLane = abandoned;
        this.elapsed = 0;
        this.duration = Math.max(.001, this.seconds * Math.abs(returnTo - this.from));
        this.onMove();
        return true;
      }
      let planned = this.target;
      for (const move of this.queue) planned += move;
      if (planned + direction < 0 || planned + direction >= this.laneCount || this.queue.length >= 8) return false;
      if (moving || this.queue.length) this.queue.push(direction);
      else this.start(direction);
      return true;
    }

    start(direction) {
      this.from = this.display;
      this.previousLane = this.target;
      this.target += direction;
      this.elapsed = 0;
      this.duration = this.seconds * Math.abs(this.target - this.from);
      this.onMove();
    }

    advance(dt) {
      // Each input always takes a full, separate animation. Even with a large
      // frame delta, never begin and finish two lane changes in one frame.
      if (this.elapsed < this.duration) {
        this.elapsed = Math.min(this.duration, this.elapsed + Math.max(0, dt));
        this.display = this.from + (this.target - this.from) * this.elapsed / this.duration;
      } else {
        this.display = this.target;
      }
      if (this.elapsed >= this.duration && this.queue.length) this.start(this.queue.shift());
      return { display: this.display, target: this.target };
    }

    plan() {
      return { from: this.from, to: this.target, elapsed: this.elapsed,
        duration: this.duration, queue: this.queue.slice() };
    }
  }
  const api = { LaneSteering };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.LaneRushLaneControls = api;
})();
