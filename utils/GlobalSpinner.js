'use strict';

const DEFAULT_SPIN_RATE_HZ = 200;

/**
 * @class ClientQueue
 * Queue of messages to handle for an individual client (subscriber or publisher)
 */
class ClientQueue {
  constructor(queueSize, throttleMs) {
    if (queueSize < 1) {
      throw new Error(`Unable to create client message queue with size ${queueSize} - minimum is 1`);
    }

    this._queue = [];
    this._queueSize = queueSize;

    this.throttleMs = throttleMs;
    this._handleTime = null;
  }

  push(item) {
    this._queue.push(item);
    if (this.length > this._queueSize) {
      this._queue.shift();
    }
  }

  get length() {
    return this._queue.length;
  }

  handleClientMessages(client, time) {
    if (this._handleTime === null || time - this._handleTime > this.throttleMs) {
      this._handleTime = time;
      client._handleMsgQueue(this._queue);
      this._queue = [];
      return true;
    }
    // else
    return false;
  }
}

/**
 * @class GlobalSpinner
 */
class GlobalSpinner {
  constructor(spinRate=DEFAULT_SPIN_RATE_HZ) {
    if (typeof spinRate !== 'number') {
      spinRate = DEFAULT_SPIN_RATE_HZ;
    }

    this._spinTime = 1 / spinRate;
    this._expectedSpinExpire = null;
    this._spinTimer = null;

    this._clientCallQueue = [];
    this._clientQueueMap = new Map();
  }

  addClient(obj, queueSize, throttleMs) {
    if (queueSize > 0) {
      this._clientQueueMap.set(obj, new ClientQueue(queueSize, throttleMs));
    }
  }

  /**
   * When subscribers/publishers receive new messages to handle, they will
   * "ping" the spinner.
   * @param client
   * @param msg
   */
  ping(client, msg) {
    this._queueMessage(client, msg);
    if (this._spinTimer === null) {
      this._setTimer();
    }
  }

  disconnect(obj) {
    const index = this._clientCallQueue.indexOf(obj);
    if (index !== -1) {
      this._clientCallQueue.splice(index ,1);
    }
    this._clientQueueMap.delete(obj);
  }

  _queueMessage(client, message) {
    const clientQueue = this._clientQueueMap.get(client);
    if (!clientQueue) {
      throw new Error('Unable to queue message for unknown client');
    }
    // else
    const prevQueueLen = clientQueue.length;

    clientQueue.push(message);

    if (prevQueueLen === 0) {
      this._clientCallQueue.push(client);
    }
  }

  _setTimer() {
    this._spinTimer = setTimeout(this._handleQueue.bind(this), this._spinTime);
    this._expectedSpinExpire = Date.now() + this._spinTime;
  }

  _handleQueue() {
    const now = Date.now();
    const keepOnQueue = [];
    for (let i = 0; i < this._clientCallQueue.length; ++i) {
      const client = this._clientCallQueue[i];
      const clientQueue = this._clientQueueMap.get(client);
      if (!clientQueue.handleClientMessages(client, now)) {
        keepOnQueue.push(client);
      }
    }

    // TODO: figure out if these clients that are throttling messages are
    // consistently keeping the timer running when it otherwise wouldn't be
    // and eating up CPU. Consider starting a slower timer if the least-throttled
    // client won't be handled for N cycles (e.g N === 5).
    this._clientCallQueue = keepOnQueue;
    if (this._clientCallQueue.length > 0) {
      this._setTimer();
    }
    else {
      this._spinTimer = null;
    }
  }
}

module.exports = GlobalSpinner;